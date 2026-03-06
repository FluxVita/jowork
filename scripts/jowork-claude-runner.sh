#!/usr/bin/env bash
# Claude Code 单轮执行器，由 jowork-dev-loop.sh 调用
# 直接在当前终端运行 claude，输出完全可见
set -euo pipefail
unset CLAUDECODE

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMPT_FILE="$REPO_DIR/.github/prompts/jowork-autonomous.md"

cd "$REPO_DIR"
git checkout monorepo-migration 2>/dev/null || true

echo "[$(date '+%H:%M:%S')] 开始第 $1 轮，读取 prompt..."
exec claude \
  --dangerously-skip-permissions \
  --max-turns 100 \
  -p "$(cat "$PROMPT_FILE")"
