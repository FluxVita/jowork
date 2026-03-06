#!/bin/bash
# FluxVita Gateway — Cloudflare Tunnel 一键安装脚本
# 在 Mac mini 上执行

set -e

TUNNEL_NAME="fluxvita"
SUBDOMAIN="fluxvita-gateway"
GATEWAY_PORT=18800
CLOUDFLARED_DIR="$HOME/.cloudflared"
CONFIG_FILE="$CLOUDFLARED_DIR/config.yml"

echo "============================================"
echo "  FluxVita Cloudflare Tunnel 安装脚本"
echo "============================================"
echo ""

# ── Step 1: 安装 cloudflared ──────────────────
echo "[1/6] 安装 cloudflared..."
if command -v cloudflared &>/dev/null; then
  echo "  ✓ cloudflared 已安装 ($(cloudflared --version 2>&1 | head -1))"
else
  if ! command -v brew &>/dev/null; then
    echo "  ✗ 未找到 Homebrew，请先安装: https://brew.sh"
    exit 1
  fi
  brew install cloudflared
  echo "  ✓ cloudflared 安装完成"
fi
echo ""

# ── Step 2: 登录 Cloudflare ───────────────────
echo "[2/6] 登录 Cloudflare 账号..."
echo "  → 复制下方 URL，在浏览器中打开并授权后，脚本会自动继续"
echo ""
cloudflared tunnel login
echo ""
echo "  ✓ 登录完成"
echo ""

# ── Step 3: 创建 Tunnel ───────────────────────
echo "[3/6] 创建 Tunnel..."
# 检查是否已存在同名 tunnel
EXISTING=$(cloudflared tunnel list 2>/dev/null | grep "^[a-f0-9-]" | awk '{print $2}' | grep "^$TUNNEL_NAME$" || true)
if [ -n "$EXISTING" ]; then
  echo "  ✓ Tunnel '$TUNNEL_NAME' 已存在，跳过创建"
else
  cloudflared tunnel create "$TUNNEL_NAME"
  echo "  ✓ Tunnel '$TUNNEL_NAME' 创建完成"
fi
echo ""

# 获取 Tunnel ID 和证书路径
TUNNEL_ID=$(cloudflared tunnel list 2>/dev/null | grep " $TUNNEL_NAME " | awk '{print $1}')
CRED_FILE="$CLOUDFLARED_DIR/${TUNNEL_ID}.json"

if [ -z "$TUNNEL_ID" ]; then
  echo "  ✗ 无法获取 Tunnel ID，请检查是否创建成功"
  exit 1
fi
echo "  Tunnel ID: $TUNNEL_ID"
echo "  证书路径: $CRED_FILE"
echo ""

# ── Step 4: 生成 config.yml ───────────────────
echo "[4/6] 生成配置文件..."
mkdir -p "$CLOUDFLARED_DIR"
cat > "$CONFIG_FILE" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CRED_FILE}

ingress:
  - hostname: ${SUBDOMAIN}.cfargotunnel.com
    service: http://localhost:${GATEWAY_PORT}
  - service: http_status:404
EOF
echo "  ✓ 配置文件写入 $CONFIG_FILE"
echo ""

# ── Step 5: 绑定 DNS ──────────────────────────
echo "[5/6] 绑定公网域名..."
cloudflared tunnel route dns "$TUNNEL_NAME" "${SUBDOMAIN}.cfargotunnel.com" || true
echo "  ✓ 域名绑定完成"
echo ""

# ── Step 6: 安装系统服务 ──────────────────────
echo "[6/6] 注册为开机自启服务..."
# 先停止已有服务（如果存在）
sudo launchctl stop com.cloudflare.cloudflared 2>/dev/null || true
sudo cloudflared service uninstall 2>/dev/null || true

sudo cloudflared service install
sudo launchctl start com.cloudflare.cloudflared
echo "  ✓ 服务已启动"
echo ""

# ── 验证 ──────────────────────────────────────
echo "============================================"
echo "  安装完成！"
echo "============================================"
echo ""
echo "  公网访问地址:"
echo "  ► https://${SUBDOMAIN}.cfargotunnel.com"
echo ""
echo "  本地 Gateway 端口: localhost:${GATEWAY_PORT}"
echo ""
echo "  检查服务状态:"
echo "  sudo launchctl list | grep cloudflare"
echo ""
echo "  查看日志:"
echo "  tail -f /tmp/com.cloudflare.cloudflared.out.log"
echo ""
echo "  DNS 生效可能需要 1-2 分钟，稍后用浏览器访问上方地址验证"
echo ""
