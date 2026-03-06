#!/usr/bin/env bash
# klaude-launcher.sh — FluxVita 团队 klaude 一键启动器
# 版本检查 → 认证 → 策略拉取 → 注入环境变量 → 启动 klaude
set -euo pipefail

# ─── 配置 ───
GATEWAY_URL="${FLUXVITA_GATEWAY:-http://jovidamac-mini:18800}"
CONFIG_DIR="$HOME/.fluxvita"
TOKEN_FILE="$CONFIG_DIR/auth_token"
POLICY_FILE="$CONFIG_DIR/policy_snapshot.json"
CHANNEL="${FLUXVITA_CHANNEL:-stable}"

mkdir -p "$CONFIG_DIR"

# ─── 颜色 ───
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[FluxVita]${NC} $1"; }
warn()  { echo -e "${YELLOW}[FluxVita]${NC} $1"; }
error() { echo -e "${RED}[FluxVita]${NC} $1"; }

# ─── 1. 版本检查 ───
check_version() {
  info "检查 klaude 版本..."
  local current_version
  current_version=$(klaude --version 2>/dev/null | head -1 || echo "unknown")

  # 尝试从 Gateway 获取最新版本号
  local latest
  latest=$(curl -sf --max-time 5 "$GATEWAY_URL/health" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','unknown'))" 2>/dev/null || echo "unknown")

  if [ "$latest" != "unknown" ] && [ "$current_version" != "$latest" ]; then
    warn "有新版本可用: $current_version → $latest"
    warn "请联系管理员获取更新，或运行: klaude-launcher.sh --update"
  else
    info "klaude 版本: $current_version"
  fi
}

# ─── 2. 认证 ───
authenticate() {
  # 检查已有 token 是否有效
  if [ -f "$TOKEN_FILE" ]; then
    local token
    token=$(cat "$TOKEN_FILE")
    local me
    me=$(curl -sf --max-time 5 -H "Authorization: Bearer $token" "$GATEWAY_URL/api/auth/me" 2>/dev/null || echo "")
    if [ -n "$me" ] && echo "$me" | python3 -c "import sys,json; json.load(sys.stdin)['user']" >/dev/null 2>&1; then
      local name
      name=$(echo "$me" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['name'])")
      info "已认证: $name"
      export FLUXVITA_AUTH_TOKEN="$token"
      return 0
    fi
    warn "Token 已过期，需要重新认证"
  fi

  # 需要飞书 OAuth 认证
  if [ "${1:-}" = "--feishu-auth" ] || [ ! -f "$TOKEN_FILE" ]; then
    info "启动飞书 OAuth 认证..."

    # 获取 OAuth URL
    local oauth_resp
    oauth_resp=$(curl -sf --max-time 10 "$GATEWAY_URL/api/auth/oauth/url?redirect_uri=http://localhost:19999/callback" 2>/dev/null || echo "")

    if [ -z "$oauth_resp" ]; then
      error "无法连接 Gateway ($GATEWAY_URL)"
      error "请确保：1) Mac mini 在线 2) Tailscale 已连接"

      # 尝试使用设备 ID + 飞书 Open ID 做 CLI 登录
      read -rp "输入你的飞书 Open ID (ou_xxx): " feishu_id
      if [ -n "$feishu_id" ]; then
        local device_id
        device_id=$(hostname)
        local cli_resp
        cli_resp=$(curl -sf --max-time 10 -X POST "$GATEWAY_URL/api/auth/cli-login" \
          -H "Content-Type: application/json" \
          -d "{\"device_id\":\"$device_id\",\"feishu_open_id\":\"$feishu_id\"}" 2>/dev/null || echo "")

        if echo "$cli_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" >/dev/null 2>&1; then
          local token
          token=$(echo "$cli_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
          echo "$token" > "$TOKEN_FILE"
          chmod 600 "$TOKEN_FILE"
          export FLUXVITA_AUTH_TOKEN="$token"
          info "CLI 认证成功"
          return 0
        else
          error "CLI 认证失败: $cli_resp"
          return 1
        fi
      fi
      return 1
    fi

    local oauth_url
    oauth_url=$(echo "$oauth_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['url'])")
    info "请在浏览器中完成飞书授权:"
    echo "  $oauth_url"
    echo ""
    read -rp "完成授权后，输入回调 URL 中的 code 参数: " auth_code

    if [ -z "$auth_code" ]; then
      error "未提供 OAuth code"
      return 1
    fi

    local token_resp
    token_resp=$(curl -sf --max-time 15 -X POST "$GATEWAY_URL/api/auth/oauth/callback" \
      -H "Content-Type: application/json" \
      -d "{\"code\":\"$auth_code\"}" 2>/dev/null || echo "")

    if echo "$token_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])" >/dev/null 2>&1; then
      local token
      token=$(echo "$token_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
      echo "$token" > "$TOKEN_FILE"
      chmod 600 "$TOKEN_FILE"
      export FLUXVITA_AUTH_TOKEN="$token"
      local name
      name=$(echo "$token_resp" | python3 -c "import sys,json; print(json.load(sys.stdin)['user']['name'])")
      info "认证成功: $name"
      return 0
    else
      error "OAuth 认证失败: $token_resp"
      return 1
    fi
  fi
}

# ─── 3. 策略拉取 ───
fetch_policy() {
  info "拉取权限策略..."
  local policy
  policy=$(curl -sf --max-time 10 -H "Authorization: Bearer $FLUXVITA_AUTH_TOKEN" \
    "$GATEWAY_URL/api/policy/me" 2>/dev/null || echo "")

  if [ -n "$policy" ]; then
    echo "$policy" > "$POLICY_FILE"
    info "策略快照已保存"
  else
    if [ -f "$POLICY_FILE" ]; then
      warn "无法获取最新策略，使用本地快照"
    else
      warn "无策略快照可用，将使用默认权限"
    fi
  fi
}

# ─── 4. 注入环境变量 ───
setup_env() {
  export FLUXVITA_GATEWAY="$GATEWAY_URL"
  export FLUXVITA_POLICY_FILE="$POLICY_FILE"
  # klaude 内部会使用这些变量连接 Gateway
  info "环境变量已配置"
}

# ─── 5. 启动 klaude ───
launch_klaude() {
  info "启动 klaude..."
  echo ""

  if command -v klaude >/dev/null 2>&1; then
    exec klaude "$@"
  else
    error "klaude 未安装。请先安装："
    echo "  go install gitlab.fluxvitae.com/fluxvita/klaude/cmd/klaude@latest"
    return 1
  fi
}

# ─── 主流程 ───
main() {
  echo ""
  info "FluxVita klaude Launcher"
  echo ""

  # 处理命令行参数
  case "${1:-}" in
    --help|-h)
      echo "Usage: klaude-launcher.sh [--feishu-auth] [--rollback] [--channel stable|beta]"
      echo ""
      echo "Options:"
      echo "  --feishu-auth    强制重新飞书认证"
      echo "  --rollback       回滚到上一个版本"
      echo "  --channel        选择版本通道 (stable/beta)"
      echo ""
      exit 0
      ;;
    --rollback)
      warn "Rollback 功能需要 GitLab Release 配置"
      exit 1
      ;;
    --channel)
      CHANNEL="${2:-stable}"
      shift 2 || true
      ;;
  esac

  # 检查 Gateway 可达性
  if ! curl -sf --max-time 3 "$GATEWAY_URL/health" >/dev/null 2>&1; then
    warn "Gateway 不可达 ($GATEWAY_URL)"
    warn "降级模式：将直接启动 klaude（无权限控制）"
    launch_klaude "$@"
    return
  fi

  check_version
  authenticate "$@" || { error "认证失败"; exit 1; }
  fetch_policy
  setup_env
  launch_klaude "$@"
}

main "$@"
