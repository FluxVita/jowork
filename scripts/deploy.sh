#!/bin/bash
# Mac mini 部署脚本 v3
#
# 三层防护：
#   1. 先复制文件（服务运行中）→ 再短暂停服重启  → 停机窗口仅 ~3s
#   2. trap EXIT → 任何失败自动回滚文件 + 重启服务
#   3. 守护 LaunchAgent（60s 轮询）→ 意外崩溃自动拉起
#
# 用法：bash deploy.sh [CI_PROJECT_DIR]

set -eo pipefail

APP_DIR="${1:-$HOME/augment-projects/fluxvita_allinone}"
FIXED_DIR="$HOME/augment-projects/fluxvita_allinone"
PLIST="$HOME/Library/LaunchAgents/com.fluxvita.allinone.plist"
JOWORK_PLIST="$HOME/Library/LaunchAgents/com.jowork.gateway.plist"
LOG_FILE="/tmp/fluxvita-deploy.log"
BACKUP_DIR="/tmp/fluxvita-dist-backup"

log() { echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

# ── 状态追踪 ──────────────────────────────────────────────────────────────────
BACKUP_DONE=false
GATEWAY_UNLOADED=false
DEPLOY_OK=false

# ── EXIT trap：失败时自动回滚 + 重启 ─────────────────────────────────────────
on_exit() {
  local code=$?
  if $DEPLOY_OK; then
    rm -rf "$BACKUP_DIR" 2>/dev/null
    return 0
  fi

  log "!!! Deploy 异常 (exit=$code)，执行自动恢复..."

  # 回滚文件到上一版本
  if $BACKUP_DONE && [ -d "$BACKUP_DIR" ]; then
    log "回滚文件..."
    for sub in packages/core/dist packages/premium/dist \
               apps/fluxvita/dist apps/jowork/dist apps/jowork/public public; do
      bak="$BACKUP_DIR/$sub"
      dst="$FIXED_DIR/$sub"
      if [ -d "$bak" ]; then
        rm -rf "$dst"
        cp -r "$bak" "$dst"
      fi
    done
    log "文件已回滚到上一版本"
  fi

  # 确保服务重启（用旧代码或新代码都行，总比挂着强）
  if $GATEWAY_UNLOADED; then
    log "重启 Gateway..."
    launchctl load "$PLIST" 2>/dev/null || true
    sleep 5
    HEALTH=$(curl -sk --max-time 5 https://localhost:19800/health | head -c 40 || echo "")
    if [ -n "$HEALTH" ]; then
      log "Gateway 已恢复运行"
    else
      log "!!! Gateway 重启后 health check 仍失败，需人工介入"
    fi
  fi

  log "!!! Deploy 失败，已自动恢复旧版本"
}
trap on_exit EXIT

# ═══════════════════════════════════════════════════════════════════════════════
log "=== FluxVita Deploy Start ==="
cd "$APP_DIR"

# 步骤 1：git pull（手动执行时）
if [ -z "$CI_PROJECT_DIR" ]; then
  log "git pull..."
  git pull --ff-only 2>&1 | tee -a "$LOG_FILE"
else
  log "CI 模式，跳过 git pull"
fi

# 步骤 2：安装依赖
command -v pnpm || npm install -g pnpm
log "pnpm install..."
pnpm install --no-frozen-lockfile 2>&1 | tail -3 | tee -a "$LOG_FILE"

# 步骤 3：编译（按依赖顺序）
log "Building @jowork/core..."
pnpm --filter @jowork/core build 2>&1 | tee -a "$LOG_FILE"

log "Building @jowork/premium..."
pnpm --filter @jowork/premium build 2>&1 | tee -a "$LOG_FILE"

log "Building @fluxvita/app..."
pnpm --filter @fluxvita/app build 2>&1 | tee -a "$LOG_FILE"

log "Building @jowork/app..."
pnpm --filter @jowork/app build 2>&1 | tee -a "$LOG_FILE"

# 步骤 4：同步产物（关键：服务仍在运行）
# 原理：rm+cp 创建新 inode，不会与运行中 Node.js 持有的文件句柄冲突
# Node.js require() 已缓存旧模块，重启时才加载新文件
if [ "$APP_DIR" != "$FIXED_DIR" ]; then
  # 4a. 备份当前版本（供回滚）
  log "备份当前版本..."
  rm -rf "$BACKUP_DIR"
  for sub in packages/core/dist packages/premium/dist \
             apps/fluxvita/dist apps/jowork/dist apps/jowork/public public; do
    src="$FIXED_DIR/$sub"
    if [ -d "$src" ]; then
      mkdir -p "$(dirname "$BACKUP_DIR/$sub")"
      cp -r "$src" "$BACKUP_DIR/$sub"
    fi
  done
  BACKUP_DONE=true
  log "备份完成"

  # 4b. 复制新产物（服务仍在运行，零风险）
  log "同步产物到服务目录（服务运行中，无停机）..."
  mkdir -p "$FIXED_DIR/packages/core" "$FIXED_DIR/packages/premium" \
           "$FIXED_DIR/apps/fluxvita" "$FIXED_DIR/apps/jowork"

  for pkg_dist in packages/core/dist packages/premium/dist \
                  apps/fluxvita/dist apps/jowork/dist; do
    rm -rf "$FIXED_DIR/$pkg_dist"
    cp -r  "$APP_DIR/$pkg_dist" "$FIXED_DIR/$pkg_dist"
  done

  rm -rf "$FIXED_DIR/apps/jowork/public"
  cp -r  "$APP_DIR/apps/jowork/public" "$FIXED_DIR/apps/jowork/"

  rm -rf "$FIXED_DIR/public"
  cp -r  "$APP_DIR/public" "$FIXED_DIR/"

  cp -f "$APP_DIR/package.json"                   "$FIXED_DIR/"
  cp -f "$APP_DIR/pnpm-lock.yaml"                 "$FIXED_DIR/"
  cp -f "$APP_DIR/pnpm-workspace.yaml"            "$FIXED_DIR/"
  cp -f "$APP_DIR/packages/core/package.json"     "$FIXED_DIR/packages/core/"
  cp -f "$APP_DIR/packages/premium/package.json"  "$FIXED_DIR/packages/premium/"
  cp -f "$APP_DIR/apps/fluxvita/package.json"     "$FIXED_DIR/apps/fluxvita/"
  cp -f "$APP_DIR/apps/jowork/package.json"       "$FIXED_DIR/apps/jowork/"

  log "文件同步完成"

  # 4c. 预热新文件到 page cache（防止 macOS APFS 首次读取 EAGAIN -11）
  # cp 写入的新 inode 在 APFS 上可能未完全 flush，node 读取时触发 EAGAIN
  # 用 cat 强制一次用户态读取，驱动 OS 把文件内容提交到 page cache
  log "预热 dist 文件到 page cache..."
  find "$FIXED_DIR/packages/core/dist" "$FIXED_DIR/apps/fluxvita/dist" \
       "$FIXED_DIR/apps/jowork/dist" "$FIXED_DIR/public" \
       "$FIXED_DIR/apps/jowork/public" \
       -name "*.js" -o -name "*.html" -o -name "*.json" 2>/dev/null \
    | xargs cat > /dev/null 2>/dev/null || true
  sync
  log "预热完成"
fi

# 步骤 5：更新 plist 入口路径（如需迁移）
if [ -f "$PLIST" ] && grep -q '>dist/index\.js<' "$PLIST"; then
  log "更新 plist 入口路径..."
  sed -i '' 's|>dist/index\.js<|>apps/fluxvita/dist/index.js<|g' "$PLIST"
fi

# 步骤 6：预检——验证新 dist 文件可被 Node.js 正常加载（防 EAGAIN -11）
log "预检：验证新 dist 文件可正常加载..."
NODE_BIN=$(command -v node || echo "/opt/homebrew/bin/node")

fv_check=$("$NODE_BIN" --input-type=module \
  --eval "import '$FIXED_DIR/apps/fluxvita/dist/index.js'" 2>&1 | head -c 200 || true)
if echo "$fv_check" | grep -qE "EAGAIN|Unknown system error -11|ERR_MODULE_NOT_FOUND"; then
  log "!!! FluxVita dist 预检失败: $fv_check"
  log "!!! 尝试在当前目录重新编译..."
  (cd "$APP_DIR" && pnpm --filter @jowork/core build && pnpm --filter @fluxvita/app build) \
    2>&1 | tail -5 | tee -a "$LOG_FILE"
  # 重新同步修复后的产物（如果是 CI 模式，APP_DIR == FIXED_DIR，直接原地重建，跳过同步）
  if [ "$APP_DIR" != "$FIXED_DIR" ]; then
    rm -rf "$FIXED_DIR/apps/fluxvita/dist" && cp -r "$APP_DIR/apps/fluxvita/dist" "$FIXED_DIR/apps/fluxvita/"
    rm -rf "$FIXED_DIR/packages/core/dist"  && cp -r "$APP_DIR/packages/core/dist"  "$FIXED_DIR/packages/core/"
  fi
  log "重编译完成，继续重启"
fi

jw_check=$("$NODE_BIN" --input-type=module \
  --eval "import '$FIXED_DIR/apps/jowork/dist/index.js'" 2>&1 | head -c 200 || true)
if echo "$jw_check" | grep -qE "EAGAIN|Unknown system error -11|ERR_MODULE_NOT_FOUND"; then
  log "!!! JoWork dist 预检失败: $jw_check"
  (cd "$APP_DIR" && pnpm --filter @jowork/app build) 2>&1 | tail -5 | tee -a "$LOG_FILE"
  if [ "$APP_DIR" != "$FIXED_DIR" ]; then
    rm -rf "$FIXED_DIR/apps/jowork/dist" && cp -r "$APP_DIR/apps/jowork/dist" "$FIXED_DIR/apps/jowork/"
  fi
  log "JoWork 重编译完成"
fi
log "预检通过，继续重启服务"

# 步骤 6b：短暂停服重启（文件已就绪，停机窗口 ~3s）
log "重启 FluxVita Gateway（文件已就绪）..."
GATEWAY_UNLOADED=true
launchctl unload "$PLIST" 2>/dev/null || true
pkill -9 -f "apps/fluxvita/dist/index" 2>/dev/null || true
sleep 2
launchctl load "$PLIST"

# JoWork Gateway（18800，Tauri 自托管模式使用）
if [ -f "$JOWORK_PLIST" ]; then
  log "重启 JoWork Gateway (18800)..."
  launchctl unload "$JOWORK_PLIST" 2>/dev/null || true
  pkill -9 -f "apps/jowork/dist/index" 2>/dev/null || true
  sleep 1
  launchctl load "$JOWORK_PLIST"
fi

# JoWork App（20800，jowork.work 公网使用）——pkill 上面已经杀过，这里只需 unload+load
JOWORK_APP_PLIST="$HOME/Library/LaunchAgents/com.jowork.app.plist"
if [ -f "$JOWORK_APP_PLIST" ]; then
  log "重启 JoWork App (20800)..."
  launchctl unload "$JOWORK_APP_PLIST" 2>/dev/null || true
  sleep 1
  launchctl load "$JOWORK_APP_PLIST"
fi

# 步骤 7：健康检查（最多等 20s）
log "等待服务启动..."
for i in 1 2 3 4; do
  sleep 5
  STATUS=$(curl -sk --max-time 5 https://localhost:19800/health | head -c 80 || echo "")
  [ -n "$STATUS" ] && break
  log "等待中... ($i/4)"
done

if [ -n "$STATUS" ]; then
  log "FluxVita Gateway 正常: $STATUS"
  DEPLOY_OK=true
else
  log "!!! FluxVita health check 失败，触发回滚"
  exit 1  # 触发 trap，自动回滚 + 重启
fi

JW_STATUS=$(curl -sk --max-time 8 https://localhost:20800/health | head -c 80 || echo "no response")
log "JoWork health: $JW_STATUS"

# 步骤 8：确保守护 LaunchAgent 已安装
WATCHDOG_DIR="$HOME/.backup/fluxvita-watchdog"
WATCHDOG_SCRIPT="$WATCHDOG_DIR/watchdog.sh"
WATCHDOG_PLIST="$HOME/Library/LaunchAgents/com.fluxvita.gateway-watchdog.plist"

if [ ! -f "$WATCHDOG_PLIST" ]; then
  log "安装 Gateway 守护 LaunchAgent..."
  mkdir -p "$WATCHDOG_DIR"

  cat > "$WATCHDOG_SCRIPT" << 'WATCHDOG_EOF'
#!/bin/bash
# FluxVita Gateway 守护脚本
# 每 60s 由 LaunchAgent 调用，检测到 Gateway 挂掉则自动重启

PLIST="$HOME/Library/LaunchAgents/com.fluxvita.allinone.plist"
LOG="/tmp/fluxvita-watchdog.log"
FAIL_FILE="/tmp/fluxvita-health-fail"

STATUS=$(curl -sk --max-time 5 https://localhost:19800/health 2>/dev/null | head -c 20)
if echo "$STATUS" | grep -q '"ok"'; then
  rm -f "$FAIL_FILE"
  exit 0
fi

# 连续失败计数（避免偶发抖动）
count=$(cat "$FAIL_FILE" 2>/dev/null || echo 0)
count=$((count + 1))
echo $count > "$FAIL_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] health check fail #$count" >> "$LOG"

if [ $count -ge 2 ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 连续 2 次失败，重启 Gateway..." >> "$LOG"
  launchctl load "$PLIST" 2>/dev/null || launchctl start com.fluxvita.allinone 2>/dev/null || true
  rm -f "$FAIL_FILE"
fi
WATCHDOG_EOF
  chmod +x "$WATCHDOG_SCRIPT"

  cat > "$WATCHDOG_PLIST" << PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.fluxvita.gateway-watchdog</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$WATCHDOG_SCRIPT</string>
  </array>
  <key>StartInterval</key>
  <integer>60</integer>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>/tmp/fluxvita-watchdog.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/fluxvita-watchdog.log</string>
</dict>
</plist>
PLIST_EOF

  launchctl load "$WATCHDOG_PLIST" 2>/dev/null || true
  log "守护 LaunchAgent 已安装并启动"
fi

log "=== Deploy Done ==="
