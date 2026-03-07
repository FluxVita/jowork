#!/bin/bash
# Session Bus — 多 Claude Code 会话协调系统
# 用法: session-bus.sh <command> [args]
#
# Commands:
#   join <name> <description>     注册当前 session（name 自取，如 "api" "frontend"）
#   leave <name>                  注销 session
#   claim <name> <file-or-dir>    声明正在操作的文件/目录
#   unclaim <name> <file-or-dir>  释放文件/目录
#   check <file> [exclude-name]   检查文件是否被其他 session 占用
#   status                        查看所有活跃 session
#   cleanup                       清理过期 session（>4h 无更新）
#   broadcast <name> <message>    广播消息给其他 session
#   log                           查看最近的广播消息

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SESSIONS_DIR="$PROJECT_ROOT/.claude/sessions"
BROADCAST_FILE="$SESSIONS_DIR/_broadcast.jsonl"
STALE_SECONDS=$((4 * 3600))

mkdir -p "$SESSIONS_DIR"

# 清理过期 session
cleanup_stale() {
  local now
  now=$(date +%s)
  for f in "$SESSIONS_DIR"/*.json; do
    [ -f "$f" ] || continue
    [[ "$(basename "$f")" == _* ]] && continue
    local mtime
    mtime=$(stat -f %m "$f" 2>/dev/null || stat -c %Y "$f" 2>/dev/null || echo 0)
    if [ $((now - mtime)) -gt $STALE_SECONDS ]; then
      local name
      name=$(basename "$f" .json)
      rm -f "$f"
      echo "[cleanup] 过期 session 已移除: $name (超过 4 小时无活动)"
    fi
  done
}

# 将相对路径转为项目内相对路径
normalize_path() {
  local p="$1"
  # 去掉项目根路径前缀，统一用相对路径
  echo "${p#$PROJECT_ROOT/}"
}

case "${1:-help}" in
  join)
    NAME="${2:?用法: join <name> <description>}"
    DESC="${3:-未描述}"
    cleanup_stale
    cat > "$SESSIONS_DIR/$NAME.json" <<ENDJSON
{
  "name": "$NAME",
  "description": "$DESC",
  "started_at": "$(date -u +%FT%TZ)",
  "updated_at": "$(date -u +%FT%TZ)",
  "claims": [],
  "edits": []
}
ENDJSON
    echo "Session [$NAME] 已注册: $DESC"
    ;;

  leave)
    NAME="${2:?用法: leave <name>}"
    if [ -f "$SESSIONS_DIR/$NAME.json" ]; then
      rm -f "$SESSIONS_DIR/$NAME.json"
      echo "Session [$NAME] 已注销"
    else
      echo "Session [$NAME] 不存在"
    fi
    ;;

  claim)
    NAME="${2:?用法: claim <name> <file-or-dir>}"
    RAW_PATH="${3:?用法: claim <name> <file-or-dir>}"
    FILE=$(normalize_path "$RAW_PATH")
    SESSION_FILE="$SESSIONS_DIR/$NAME.json"
    if [ ! -f "$SESSION_FILE" ]; then
      echo "Session [$NAME] 未注册，请先 join"
      exit 1
    fi
    jq --arg f "$FILE" --arg t "$(date -u +%FT%TZ)" \
      'if (.claims | index($f)) then . else .claims += [$f] | .updated_at = $t end' \
      "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
    echo "[$NAME] 声明: $FILE"
    ;;

  unclaim)
    NAME="${2:?用法: unclaim <name> <file-or-dir>}"
    RAW_PATH="${3:?用法: unclaim <name> <file-or-dir>}"
    FILE=$(normalize_path "$RAW_PATH")
    SESSION_FILE="$SESSIONS_DIR/$NAME.json"
    if [ ! -f "$SESSION_FILE" ]; then
      echo "Session [$NAME] 不存在"
      exit 1
    fi
    jq --arg f "$FILE" --arg t "$(date -u +%FT%TZ)" \
      '.claims -= [$f] | .updated_at = $t' \
      "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
    echo "[$NAME] 释放: $FILE"
    ;;

  check)
    RAW_PATH="${2:?用法: check <file> [exclude-name]}"
    FILE=$(normalize_path "$RAW_PATH")
    EXCLUDE="${3:-}"
    cleanup_stale
    CONFLICTS=""
    for f in "$SESSIONS_DIR"/*.json; do
      [ -f "$f" ] || continue
      [[ "$(basename "$f")" == _* ]] && continue
      RESULT=$(jq -r --arg file "$FILE" --arg exclude "$EXCLUDE" '
        select(.name != $exclude) |
        .claims[] as $c |
        select(
          ($file | startswith($c)) or
          ($c | startswith($file)) or
          ($c == $file)
        ) |
        "\(.name) (\(.description)) 正在操作: \($c)"
      ' "$f" 2>/dev/null) || true
      if [ -n "$RESULT" ]; then
        CONFLICTS="${CONFLICTS}${RESULT}\n"
      fi
    done
    if [ -n "$CONFLICTS" ]; then
      echo -e "CONFLICT:\n$CONFLICTS"
      exit 1
    else
      echo "OK: $FILE 无冲突"
      exit 0
    fi
    ;;

  record)
    # 内部命令：hooks 调用，记录实际编辑的文件
    NAME="${2:?}"
    RAW_PATH="${3:?}"
    FILE=$(normalize_path "$RAW_PATH")
    SESSION_FILE="$SESSIONS_DIR/$NAME.json"
    [ -f "$SESSION_FILE" ] || exit 0
    jq --arg f "$FILE" --arg t "$(date -u +%FT%TZ)" \
      '.edits += [{"file": $f, "at": $t}] | .edits = (.edits | .[-50:]) | .updated_at = $t' \
      "$SESSION_FILE" > "$SESSION_FILE.tmp" && mv "$SESSION_FILE.tmp" "$SESSION_FILE"
    ;;

  status)
    cleanup_stale
    HAS_SESSIONS=0
    echo "=== Session Bus 状态 ==="
    echo ""
    for f in "$SESSIONS_DIR"/*.json; do
      [ -f "$f" ] || continue
      [[ "$(basename "$f")" == _* ]] && continue
      HAS_SESSIONS=1
      jq -r '
        "  [\(.name)] \(.description)",
        "    注册: \(.started_at)  更新: \(.updated_at)",
        "    声明: \(if (.claims | length) > 0 then (.claims | join(", ")) else "(无)" end)",
        "    最近编辑: \(if (.edits | length) > 0 then ([.edits[-3:][] | .file] | join(", ")) else "(无)" end)",
        ""
      ' "$f"
    done
    if [ $HAS_SESSIONS -eq 0 ]; then
      echo "  (无活跃 session)"
    fi
    ;;

  broadcast)
    NAME="${2:?用法: broadcast <name> <message>}"
    MSG="${3:?用法: broadcast <name> <message>}"
    echo "{\"from\":\"$NAME\",\"at\":\"$(date -u +%FT%TZ)\",\"msg\":\"$MSG\"}" >> "$BROADCAST_FILE"
    echo "[$NAME] 广播: $MSG"
    ;;

  log)
    if [ -f "$BROADCAST_FILE" ]; then
      echo "=== 最近广播 ==="
      tail -20 "$BROADCAST_FILE" | jq -r '"  [\(.from)] \(.at): \(.msg)"'
    else
      echo "(无广播记录)"
    fi
    ;;

  cleanup)
    cleanup_stale
    echo "清理完成"
    ;;

  help|*)
    cat <<'USAGE'
Session Bus — 多 Claude Code 会话协调

命令:
  join <name> <desc>       注册 session
  leave <name>             注销 session
  claim <name> <path>      声明操作范围
  unclaim <name> <path>    释放操作范围
  check <path> [exclude]   检查文件冲突
  status                   查看活跃 session
  broadcast <name> <msg>   广播消息
  log                      查看广播记录
  cleanup                  清理过期 session

示例:
  session-bus.sh join api "重构认证模块"
  session-bus.sh claim api src/auth/
  session-bus.sh check src/auth/settings.ts
  session-bus.sh status
  session-bus.sh broadcast api "认证模块重构完成，接口签名有变化"
  session-bus.sh leave api
USAGE
    ;;
esac
