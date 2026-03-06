#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# scripts/test-browser.sh — JoWork/FluxVita UI E2E 测试
#
# 用法:
#   ./scripts/test-browser.sh
#   GATEWAY_URL=http://localhost:18800 ./scripts/test-browser.sh
#   TEST_DEV_ID=ou_xxx TEST_DEV_NAME=张三 ./scripts/test-browser.sh
# ─────────────────────────────────────────────────────────────
set -eo pipefail

BASE="${GATEWAY_URL:-http://localhost:18800}"
DEV_ID="${TEST_DEV_ID:-ou_test_demo_user_001}"
DEV_NAME="${TEST_DEV_NAME:-UITest}"
SCREENSHOT_DIR="${SCREENSHOT_DIR:-/tmp/jowork-ui-test}"
PASS=0; FAIL=0
ERRORS=()

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; RESET='\033[0m'
log_ok()   { echo -e "${GREEN}  ✓${RESET} $1"; }
log_fail() { echo -e "${RED}  ✗${RESET} $1"; }
log_info() { echo -e "${CYAN}  ─${RESET} $1"; }

if ! command -v agent-browser &>/dev/null; then
  echo -e "${RED}ERROR: agent-browser 未安装${RESET}"
  echo "安装方式: npm install -g agent-browser && agent-browser install"
  exit 1
fi

mkdir -p "$SCREENSHOT_DIR"
echo -e "\n${CYAN}=== JoWork/FluxVita UI E2E 测试 ===${RESET}"
echo -e "Gateway: ${BASE}\n"

# 清除旧 session，防止 onboarding 被重定向到 shell.html
# 策略：open onboarding.html → 被重定向到 shell.html → eval 清除 localStorage 并立即跳回 onboarding
log_info "清除浏览器 session..."
ab open "${BASE}/onboarding.html" 2>/dev/null || true
sleep 1.0
ab eval "localStorage.clear(); sessionStorage.clear(); window.location.replace('/onboarding.html');" 2>/dev/null || true
sleep 1.5

run_test() {
  local name="$1"; shift
  if "$@" &>/dev/null; then
    log_ok "$name"; ((PASS++)) || true
  else
    log_fail "$name"; ERRORS+=("$name"); ((FAIL++)) || true
  fi
}

ab() { agent-browser "$@"; }
snap() { ab screenshot "$1" 2>/dev/null || true; log_info "截图 -> $(basename $1)"; }

# ═══════════════════════════════════════════════════════
# Suite 1 — Onboarding 流程
# ═══════════════════════════════════════════════════════
echo -e "${CYAN}[Suite 1] Onboarding 流程${RESET}"

ab open "${BASE}/onboarding.html" 2>/dev/null || {
  log_fail "打开 onboarding 页面"; ((FAIL++)) || true; ERRORS+=("打开 onboarding 页面")
}

run_test "Step-1 欢迎页可见" ab wait "#step-1"
snap "${SCREENSHOT_DIR}/01-onboarding-step1.png"

# Step-1 → Step-2：点击"开始配置"
run_test "点击「开始配置」进入 Step-2" ab click "button:has-text('开始配置')"
sleep 0.6
run_test "Step-2 隐私说明可见" ab wait "#step-2.visible"
snap "${SCREENSHOT_DIR}/02-onboarding-step2.png"

# Step-2 → Step-3：点击"下一步"
run_test "点击「下一步」进入 Step-3" ab click "button:has-text('下一步')"
sleep 0.6
run_test "Step-3 AI 能力页可见" ab wait "#step-3.visible"

# Step-3 → Step-4：点击"开始配置"（第二次出现）
run_test "点击「开始配置」进入 Step-4 登录" ab click "button:has-text('开始配置')"
sleep 0.6
run_test "Step-4 登录页可见" ab wait "#step-4.visible"
snap "${SCREENSHOT_DIR}/03-onboarding-step4-login.png"

# Step-4：展开「开发模式登录」<details> 折叠块
ab eval "document.querySelector('#step-4 details').open = true" 2>/dev/null || true
sleep 0.3

# Step-4：开发模式登录（填 dev-id / dev-name）
run_test "输入 Dev Open ID" ab fill "#dev-id" "$DEV_ID"
run_test "输入 Dev Name"   ab fill "#dev-name" "$DEV_NAME"
run_test "点击登录"         ab click "#step-4 details button"
sleep 2.5

run_test "登录后进入 Step-5" ab wait "#step-5.visible"
snap "${SCREENSHOT_DIR}/04-onboarding-step5.png"

# Step-5 → Step-6
run_test "点击继续进入 Step-6" ab click "button:has-text('继续')"
sleep 0.5

# Step-6 可能是 workstyle 或数据源，检查存在即可
run_test "Step-6 页面可见" ab wait "#step-6.visible"

# 若存在 workstyle 输入框，填写
if ab wait "#workstyle-input" &>/dev/null; then
  run_test "填写工作方式" \
    ab fill "#workstyle-input" "我是一名产品经理，每天使用飞书协作，关注用户增长和产品数据。"
  snap "${SCREENSHOT_DIR}/05-onboarding-workstyle.png"
  ab click "button:has-text('继续')" 2>/dev/null; sleep 0.5
fi

log_info "Onboarding 流程验证完成"

# ═══════════════════════════════════════════════════════
# Suite 2 — Chat 对话流程
# ═══════════════════════════════════════════════════════
echo -e "\n${CYAN}[Suite 2] Chat 对话流程${RESET}"

# 用 curl 获取 dev token（绕过 browser login form 的 OAuth 干扰）
log_info "获取测试 token..."
_RESP1=$(curl -s -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"feishu_open_id\":\"${DEV_ID}\",\"name\":\"${DEV_NAME}\"}")
_CHALLENGE=$(echo "$_RESP1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('challenge_id',''))" 2>/dev/null)
_CODE=$(echo "$_RESP1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('dev_code',''))" 2>/dev/null)
CHAT_TOKEN=$(curl -s -X POST "${BASE}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"feishu_open_id\":\"${DEV_ID}\",\"name\":\"${DEV_NAME}\",\"challenge_id\":\"${_CHALLENGE}\",\"code\":\"${_CODE}\"}" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token',''))" 2>/dev/null)

if [ -n "$CHAT_TOKEN" ]; then
  log_ok "测试 token 获取成功"; ((PASS++)) || true
else
  log_fail "获取测试 token 失败"; ERRORS+=("获取测试 token"); ((FAIL++)) || true
fi

ab open "${BASE}/chat.html" 2>/dev/null || {
  log_fail "打开 chat 页面"; ((FAIL++)) || true; ERRORS+=("打开 chat 页面")
}
sleep 0.8
snap "${SCREENSHOT_DIR}/06-chat-login.png"

# 注入 token，绕过 login form（避免 OAuth button 干扰）
ab eval "localStorage.setItem('fluxvita_token','${CHAT_TOKEN}'); window.location.reload();" 2>/dev/null || true
sleep 2.5

run_test "Chat 欢迎消息可见" ab wait ".message.welcome"
snap "${SCREENSHOT_DIR}/07-chat-screen.png"

run_test "填写测试消息" \
  ab eval "document.getElementById('input').value='你好，这是一条E2E自动化测试消息，请简短回复。'"
snap "${SCREENSHOT_DIR}/08-chat-before-send.png"

run_test "发送消息" ab eval "sendMessage()"
log_info "等待 AI 响应（最多 20s）..."
sleep 15

# AI 回复消息（.message.bot）或错误消息（.message.error，本地无 AI 时）
run_test "AI 或错误响应出现" ab wait ".message.bot,.message.error"
snap "${SCREENSHOT_DIR}/09-chat-response.png"

run_test "新建对话按钮可见" ab wait ".new-chat-btn"
run_test "点击新建对话"     ab click ".new-chat-btn"
sleep 0.5
snap "${SCREENSHOT_DIR}/10-chat-new-session.png"

ab close 2>/dev/null || true

# ═══════════════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════════════
TOTAL=$((PASS + FAIL))
echo -e "\n${CYAN}=== 测试结果 ===${RESET}"
echo -e "通过: ${GREEN}${PASS}${RESET}  失败: ${RED}${FAIL}${RESET}  总计: ${TOTAL}"

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo -e "\n${RED}失败项:${RESET}"
  for e in "${ERRORS[@]}"; do echo -e "  ${RED}✗${RESET} $e"; done
fi

echo -e "\n截图目录: ${SCREENSHOT_DIR}/"
ls "${SCREENSHOT_DIR}/" 2>/dev/null | sed 's/^/  /'

[ $FAIL -eq 0 ] \
  && echo -e "\n${GREEN}所有测试通过${RESET}" && exit 0 \
  || echo -e "\n${RED}有 ${FAIL} 个测试失败${RESET}" && exit 1
