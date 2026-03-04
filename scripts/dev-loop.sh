#!/usr/bin/env bash
# Jowork 本地自动开发循环
# 在 MacBook 上直接运行，使用已登录的 Claude Code 订阅账号
# 用法：bash scripts/dev-loop.sh

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMPT_FILE="$REPO_DIR/.github/prompts/autonomous-dev.md"
CYCLE_PAUSE=10    # 两次循环之间停顿秒数

cd "$REPO_DIR"

git config user.name  "Claude Code [bot]"
git config user.email "claude-bot@fluxvita.com"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Jowork 自动开发循环（本地 MacBook 模式）               ║"
echo "║  仓库: $REPO_DIR"
echo "║  按 Ctrl+C 随时停止                                    ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

CYCLE=0

while true; do
  CYCLE=$((CYCLE + 1))
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🤖 第 $CYCLE 轮 | $(date '+%H:%M:%S')"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # 拉取最新（防止和 GitHub 冲突）
  git pull --rebase origin main 2>/dev/null || true

  # 检查是否还有待做的任务
  if ! grep -qE "⏳ 未开始|\[ \] " docs/JOWORK-PLAN.md 2>/dev/null; then
    echo "🎉 所有任务已完成！退出循环。"
    git log --oneline -10
    break
  fi

  # 运行 Claude Code（非交互模式，使用订阅账号）
  echo "🚀 启动 Claude Code..."
  claude \
    --dangerously-skip-permissions \
    --max-turns 150 \
    -p "$(cat "$PROMPT_FILE")" \
    2>&1 || {
      echo "⚠️  Claude Code 本轮退出（可能触发速率限制），${CYCLE_PAUSE}s 后继续..."
      sleep "$CYCLE_PAUSE"
      continue
    }

  # 有改动就提交推送
  if [ -n "$(git status --porcelain)" ]; then
    echo "📝 提交并推送..."
    git add -A
    CHANGED_FILES=$(git diff --cached --name-only | head -8 | tr '\n' ' ')
    git commit -m "feat(ai): cycle $CYCLE — $CHANGED_FILES

Auto-commit from Claude Code autonomous dev loop.
$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    git push origin main
    echo "✅ 第 $CYCLE 轮完成，已推送到 GitHub"
  else
    echo "ℹ️  本轮无文件变动"
  fi

  echo "💤 等待 ${CYCLE_PAUSE}s..."
  sleep "$CYCLE_PAUSE"
done
