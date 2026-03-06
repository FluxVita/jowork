#!/bin/bash
# FluxVita Cloudflare Tunnel 一键配置脚本
# 在 Mac mini 上运行，将 localhost:18800 暴露为 gateway.fluxvita.com
#
# 前置条件:
#   - fluxvita.com 域名已托管在 Cloudflare DNS
#   - 已登录 Cloudflare 账号
#
# 用法: bash scripts/setup-tunnel.sh

set -euo pipefail

TUNNEL_NAME="fluxvita-gateway"
DOMAIN="gateway.fluxvita.com"
LOCAL_PORT=18800
CONFIG_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CONFIG_DIR/config.yml"
PLIST_NAME="com.fluxvita.cloudflared"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

echo "=== FluxVita Cloudflare Tunnel 配置 ==="
echo ""

# Step 1: 安装 cloudflared
if ! command -v cloudflared &>/dev/null; then
  echo "[1/6] 安装 cloudflared..."
  brew install cloudflared
else
  echo "[1/6] cloudflared 已安装: $(cloudflared --version)"
fi

# Step 2: 登录授权
if [ ! -f "$CONFIG_DIR/cert.pem" ]; then
  echo "[2/6] 登录 Cloudflare（浏览器授权）..."
  cloudflared tunnel login
else
  echo "[2/6] 已授权"
fi

# Step 3: 创建隧道
EXISTING=$(cloudflared tunnel list --output json 2>/dev/null | python3 -c "
import sys, json
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t['name'] == '$TUNNEL_NAME':
        print(t['id'])
        break
" 2>/dev/null || echo "")

if [ -z "$EXISTING" ]; then
  echo "[3/6] 创建隧道 $TUNNEL_NAME..."
  cloudflared tunnel create "$TUNNEL_NAME"
  TUNNEL_ID=$(cloudflared tunnel list --output json | python3 -c "
import sys, json
tunnels = json.load(sys.stdin)
for t in tunnels:
    if t['name'] == '$TUNNEL_NAME':
        print(t['id'])
        break
")
else
  TUNNEL_ID="$EXISTING"
  echo "[3/6] 隧道已存在: $TUNNEL_ID"
fi

# Step 4: 写入配置
echo "[4/6] 写入 $CONFIG_FILE..."
mkdir -p "$CONFIG_DIR"
cat > "$CONFIG_FILE" <<EOF
tunnel: $TUNNEL_ID
credentials-file: $CONFIG_DIR/$TUNNEL_ID.json

ingress:
  - hostname: $DOMAIN
    service: http://localhost:$LOCAL_PORT
  - service: http_status:404
EOF

echo "  配置内容:"
cat "$CONFIG_FILE"
echo ""

# Step 5: DNS 路由
echo "[5/6] 配置 DNS 路由 $DOMAIN..."
cloudflared tunnel route dns "$TUNNEL_NAME" "$DOMAIN" 2>/dev/null || echo "  DNS 记录可能已存在，跳过"

# Step 6: LaunchAgent（开机自启）
echo "[6/6] 注册 LaunchAgent..."
cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_NAME</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(which cloudflared)</string>
    <string>tunnel</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/cloudflared.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/cloudflared.err</string>
</dict>
</plist>
EOF

launchctl unload "$PLIST_PATH" 2>/dev/null || true
launchctl load "$PLIST_PATH"

echo ""
echo "=== 完成 ==="
echo "隧道 ID:    $TUNNEL_ID"
echo "访问地址:   https://$DOMAIN"
echo "本地服务:   http://localhost:$LOCAL_PORT"
echo "LaunchAgent: $PLIST_PATH"
echo ""
echo "管理命令:"
echo "  cloudflared tunnel info $TUNNEL_NAME  # 查看状态"
echo "  cloudflared tunnel run                # 手动启动"
echo "  launchctl unload $PLIST_PATH          # 停用自启"
