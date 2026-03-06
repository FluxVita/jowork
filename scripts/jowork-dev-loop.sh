#!/usr/bin/env bash
# Jowork 自主开发循环
# 在独立 Terminal 窗口运行（不能在 Claude Code 里运行）：
#   cd /Users/signalz/Documents/augment-projects/fluxvita_allinone
#   bash scripts/jowork-dev-loop.sh
#
# Claude 的完整输出会直接显示在这个终端里，跟平时手动跑 claude 一样。
# Ctrl+C 随时停止。

set -euo pipefail
unset CLAUDECODE  # 防止 claude 报"嵌套 session"错误

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLAN="$REPO_DIR/docs/JOWORK-PLAN.md"
PROMPT="$REPO_DIR/.github/prompts/jowork-autonomous.md"
BRANCH="monorepo-migration"
MAX=20

cd "$REPO_DIR"

# 切到正确分支
CURRENT=$(git branch --show-current)
if [ "$CURRENT" != "$BRANCH" ]; then
  echo "切换分支: $CURRENT -> $BRANCH"
  git checkout "$BRANCH"
fi

pending() { grep -c '- \[ \]' "$PLAN" 2>/dev/null || echo 0; }
done_ct() { grep -c '- \[x\]' "$PLAN" 2>/dev/null || echo 0; }

echo ""
echo "======================================"
echo " Jowork 自主开发循环"
echo " 分支: $BRANCH"
echo " 待完成: $(pending) 项 | 已完成: $(done_ct) 项"
echo " Ctrl+C 停止"
echo "======================================"

ROUND=1
while [ "$ROUND" -le "$MAX" ]; do
  P=$(pending)
  [ "$P" -eq 0 ] && { echo ""; echo "✅ 所有任务完成！"; break; }

  echo ""
  echo "══════════════════════════════════════"
  echo " 第 $ROUND 轮 | $(date '+%H:%M:%S')"
  echo " 待完成: $P | 已完成: $(done_ct)"
  echo " 下一任务: $(grep -m1 '- \[ \]' "$PLAN" | sed 's/- \[ \] //')"
  echo "══════════════════════════════════════"
  echo ""

  # 直接在此终端运行 claude，输出完全可见（工具调用、思考过程都显示）
  claude \
    --dangerously-skip-permissions \
    --max-turns 100 \
    -p "$(cat "$PROMPT")" || true

  # 提交新改动
  git add -A 2>/dev/null || true
  if ! git diff --cached --quiet 2>/dev/null; then
    MSG="feat(jowork): 第${ROUND}轮 - $(grep -m1 '- \[x\]' "$PLAN" | tail -1 | sed 's/- \[x\] //' | cut -c1-60)"
    git commit -m "$MSG

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>" || true
    git push origin "$BRANCH" || echo "push 失败，继续"
  else
    echo "（本轮无新提交）"
  fi

  ROUND=$((ROUND + 1))
  [ "$ROUND" -le "$MAX" ] && sleep 5
done

echo ""
echo "结束 | 共 $ROUND 轮 | 已完成 $(done_ct) 项"
