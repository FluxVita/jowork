#!/bin/bash
# 本地 Stripe 开发一键启动
# 用法：bash scripts/dev-stripe.sh
#
# 会做：
# 1. 启动 Gateway（npm run dev）
# 2. 启动 stripe listen，自动捕获 webhook secret 并写入 .env
# 3. Gateway 自动重启生效

set -e

STRIPE="$HOME/bin/stripe"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/.env"

# 检查 stripe 是否存在
if [ ! -f "$STRIPE" ]; then
  echo "❌ stripe CLI 未找到，请先运行安装脚本"
  exit 1
fi

echo "🚀 启动本地 Stripe 开发环境..."

# 用 tmux 管理多个进程（如果不在 tmux 里就创建一个 session）
if [ -z "$TMUX" ]; then
  echo "📌 在 tmux session 'stripe-dev' 中启动..."
  tmux new-session -d -s stripe-dev -n gateway 2>/dev/null || true
  tmux send-keys -t stripe-dev:gateway "cd '$ROOT' && npm run dev" Enter
  tmux new-window -t stripe-dev -n stripe-listen
  tmux send-keys -t stripe-dev:stripe-listen "cd '$ROOT' && bash scripts/dev-stripe.sh --inner" Enter
  tmux attach -t stripe-dev
  exit 0
fi

# --inner 模式：捕获 webhook secret 并写入 .env
if [ "$1" = "--inner" ]; then
  echo "⏳ 等待 Gateway 启动（5s）..."
  sleep 5

  echo "📡 启动 stripe listen，自动捕获 webhook secret..."

  # 启动 stripe listen，把输出同时打印和写文件
  TMPLOG=$(mktemp)
  $STRIPE listen --forward-to localhost:18800/api/billing/webhook 2>&1 | tee "$TMPLOG" &
  LISTEN_PID=$!

  # 等待 whsec_ 出现（最多 15 秒）
  for i in $(seq 1 30); do
    sleep 0.5
    WHSEC=$(grep -o 'whsec_[a-zA-Z0-9]*' "$TMPLOG" 2>/dev/null | head -1)
    if [ -n "$WHSEC" ]; then break; fi
  done

  if [ -z "$WHSEC" ]; then
    echo "❌ 未能获取 webhook secret，请检查 stripe login 状态"
    kill $LISTEN_PID 2>/dev/null
    rm -f "$TMPLOG"
    exit 1
  fi

  echo "✅ 获取到 webhook secret: ${WHSEC:0:20}..."

  # 写入 .env（替换或追加）
  if grep -q "^STRIPE_WEBHOOK_SECRET=" "$ENV_FILE" 2>/dev/null; then
    sed -i '' "s/^STRIPE_WEBHOOK_SECRET=.*/STRIPE_WEBHOOK_SECRET=$WHSEC/" "$ENV_FILE"
  else
    echo "STRIPE_WEBHOOK_SECRET=$WHSEC" >> "$ENV_FILE"
  fi
  echo "✅ .env 已更新"

  rm -f "$TMPLOG"

  # 等待 stripe listen 进程（Ctrl+C 退出）
  wait $LISTEN_PID
  exit 0
fi

echo "提示：请在项目根目录运行 bash scripts/dev-stripe.sh"
