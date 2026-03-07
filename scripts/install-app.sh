#!/bin/bash
# 打包并安装桌面 App 到 /Applications
# 用法：
#   bash scripts/install-app.sh both       ← FluxVita + JoWork（默认）
#   bash scripts/install-app.sh fluxvita   ← 仅 FluxVita
#   bash scripts/install-app.sh jowork     ← 仅 JoWork
#
# "打包" 定义：build .app → kill 旧进程 → 复制到 /Applications

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-both}"

build_and_install() {
  local name="$1"
  local filter="$2"    # pnpm filter，空字符串=根目录
  local app_src="$3"
  local proc="$4"
  local dst="/Applications/${name}.app"

  echo ""
  echo "=== ${name} ==="

  # 1. Build
  echo "▸ 构建 ${name}..."
  if [ -z "$filter" ]; then
    (cd "$ROOT" && pnpm tauri:build 2>&1 | tail -5)
  else
    (cd "$ROOT" && pnpm --filter "$filter" tauri:build 2>&1 | tail -5)
  fi

  if [ ! -d "$app_src" ]; then
    echo "✗ 构建失败，未找到 $app_src"
    exit 1
  fi

  # 2. Kill 旧进程
  if pgrep -f "$proc" > /dev/null 2>&1; then
    echo "▸ 关闭正在运行的 ${name}..."
    pkill -f "$proc" 2>/dev/null || true
    sleep 1
  fi

  # 3. 安装到 /Applications
  echo "▸ 安装 -> $dst"
  rm -rf "$dst"
  cp -R "$app_src" "$dst"

  echo "✓ ${name} 安装完成"
}

do_fluxvita() {
  build_and_install \
    "FluxVita" \
    "" \
    "$ROOT/src-tauri/target/release/bundle/macos/FluxVita.app" \
    "FluxVita"
}

do_jowork() {
  build_and_install \
    "Jowork" \
    "@jowork/app" \
    "$ROOT/apps/jowork/src-tauri/target/release/bundle/macos/Jowork.app" \
    "Jowork"
}

case "$TARGET" in
  fluxvita) do_fluxvita ;;
  jowork)   do_jowork ;;
  both)     do_fluxvita; do_jowork ;;
  *)
    echo "用法: $0 [both|fluxvita|jowork]"
    exit 1
    ;;
esac

# 刷新图标缓存
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister \
  -kill -r -domain local -domain system -domain user 2>/dev/null || true
killall Dock 2>/dev/null || true

echo ""
echo "=== 全部完成 ==="
