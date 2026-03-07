#!/bin/bash
# PreToolUse hook: 编辑文件前检查是否被其他 session 占用
# 从 stdin 读取 JSON 事件，检查 .claude/sessions/ 中的冲突
# 返回 {"decision":"block","reason":"..."} 可阻止操作

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SESSIONS_DIR="$PROJECT_ROOT/.claude/sessions"
BUS="$PROJECT_ROOT/.claude/scripts/session-bus.sh"

# 读取事件 JSON
EVENT=$(cat)

# 提取文件路径
FILE_PATH=$(echo "$EVENT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || true
[ -z "$FILE_PATH" ] && exit 0

# 获取当前 session 名（从 MY_SESSION_NAME 环境变量，session join 时设置）
MY_NAME="${CLAUDE_SESSION_NAME:-}"
[ -z "$MY_NAME" ] && exit 0

# 检查冲突
CONFLICT=$(bash "$BUS" check "$FILE_PATH" "$MY_NAME" 2>/dev/null) || true

if echo "$CONFLICT" | grep -q "^CONFLICT:"; then
  # 有冲突，但不 block — 输出警告让 Claude 自己判断
  # 如果需要强制阻止，取消下面的注释：
  # echo "{\"decision\":\"block\",\"reason\":\"$CONFLICT\"}"
  echo "$CONFLICT" >&2
fi

exit 0
