#!/bin/bash
# PostToolUse hook: 编辑文件后自动记录到 session bus
# 从 stdin 读取 JSON 事件

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUS="$PROJECT_ROOT/.claude/scripts/session-bus.sh"

# 读取事件 JSON
EVENT=$(cat)

# 提取文件路径
FILE_PATH=$(echo "$EVENT" | jq -r '.tool_input.file_path // empty' 2>/dev/null) || true
[ -z "$FILE_PATH" ] && exit 0

# 获取当前 session 名
MY_NAME="${CLAUDE_SESSION_NAME:-}"
[ -z "$MY_NAME" ] && exit 0

# 记录编辑
bash "$BUS" record "$MY_NAME" "$FILE_PATH" 2>/dev/null || true

exit 0
