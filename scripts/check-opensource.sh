#!/usr/bin/env bash
# ============================================================
# check-opensource.sh — JoWork 开源代码安全检查
#
# 目的：确保 apps/jowork/ 和 packages/core/ 不含
#       任何 FluxVita 内部品牌/私钥泄露内容。
#
# 用法：
#   ./scripts/check-opensource.sh          # 本地 push 前运行
#   bash scripts/check-opensource.sh --ci  # CI 环境（出错时 exit 1）
#
# 检查项：
#   1. apps/jowork/public/ HTML 文件不含 FluxVita 专有 token key
#   2. apps/jowork/public/ HTML 文件不含 fv_admin_token / fluxvita_token
#   3. packages/core/ 不含 FluxVita 私有域名/密钥
#   4. apps/jowork/public/ 存在 shell.html 中引用的所有 iframe 页面
# ============================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JOWORK_PUBLIC="${REPO_ROOT}/apps/jowork/public"
CORE_SRC="${REPO_ROOT}/packages/core/src"
ERRORS=0
CI_MODE="${1:-}"

red()   { echo -e "\033[0;31m✗ $*\033[0m"; }
green() { echo -e "\033[0;32m✓ $*\033[0m"; }
warn()  { echo -e "\033[0;33m⚠ $*\033[0m"; }
info()  { echo -e "\033[0;36m▶ $*\033[0m"; }

fail() { red "$*"; ERRORS=$((ERRORS + 1)); }

echo ""
echo "════════════════════════════════════════════════════"
echo "  JoWork 开源安全检查"
echo "════════════════════════════════════════════════════"
echo ""

# ──────────────────────────────────────────────────────────
# CHECK 1: apps/jowork/public/ 不含 FluxVita 专有 token key
# ──────────────────────────────────────────────────────────
info "CHECK 1: apps/jowork/public/ HTML 中不含 FluxVita token key"

LEAKED_TOKEN_FILES=$(grep -rl "fluxvita_token\|fv_admin_token\|fluxvita_admin" \
  "${JOWORK_PUBLIC}" --include="*.html" --include="*.js" 2>/dev/null || true)

if [ -n "$LEAKED_TOKEN_FILES" ]; then
  fail "以下文件含 FluxVita token key（应改为 jowork_token）："
  echo "$LEAKED_TOKEN_FILES" | while IFS= read -r f; do
    echo "    $(basename "$f")"
    grep -n "fluxvita_token\|fv_admin_token\|fluxvita_admin" "$f" | head -3 | sed 's/^/      /'
  done
else
  green "无 FluxVita token key 泄露"
fi

# ──────────────────────────────────────────────────────────
# CHECK 2: apps/jowork/public/ 不含 FluxVita 品牌文本（可见文本）
# ──────────────────────────────────────────────────────────
info "CHECK 2: apps/jowork/public/ HTML 不含 FluxVita 品牌可见文本"

# 排除注释和代码里的正当引用（如 copyright、架构说明）
BRAND_FILES=$(grep -rl "FluxVita 管理后台\|FluxVita AI 助手\|FluxVita 数据\|FluxVita Gateway\|>FluxVita<" \
  "${JOWORK_PUBLIC}" --include="*.html" 2>/dev/null || true)

if [ -n "$BRAND_FILES" ]; then
  fail "以下文件含 FluxVita 品牌可见文本（用户可见界面）："
  echo "$BRAND_FILES" | while IFS= read -r f; do
    echo "    $(basename "$f")"
    grep -n "FluxVita 管理后台\|FluxVita AI 助手\|FluxVita 数据\|FluxVita Gateway\|>FluxVita<" "$f" | head -3 | sed 's/^/      /'
  done
else
  green "无 FluxVita 品牌文本泄露"
fi

# ──────────────────────────────────────────────────────────
# CHECK 3: packages/core/ 不含 FluxVita 私有域名/凭据
# ──────────────────────────────────────────────────────────
info "CHECK 3: packages/core/ 不含私有域名或凭据硬编码"

PRIVATE_DOMAINS="fluxvitae\.com\|gitlab\.fluxvitae\.com\|glpat-\|sk_live_\|sk_test_[a-zA-Z0-9]\{20,\}"

PRIVATE_FILES=$(grep -rl "$PRIVATE_DOMAINS" \
  "${CORE_SRC}" --include="*.ts" --include="*.js" 2>/dev/null || true)

if [ -n "$PRIVATE_FILES" ]; then
  fail "以下 packages/core 文件含私有域名或凭据（不应进入开源代码）："
  echo "$PRIVATE_FILES" | while IFS= read -r f; do
    echo "    ${f#"${REPO_ROOT}/"}"
    grep -n "$PRIVATE_DOMAINS" "$f" | head -3 | sed 's/^/      /'
  done
else
  green "无私有域名/凭据硬编码"
fi

# ──────────────────────────────────────────────────────────
# CHECK 4: apps/jowork/public/ 必须包含 shell.html 引用的所有页面
# ──────────────────────────────────────────────────────────
info "CHECK 4: apps/jowork/public/ 存在所有 shell.html 引用的 iframe 页面"

SHELL_HTML="${JOWORK_PUBLIC}/shell.html"
MISSING_PAGES=0

if [ ! -f "$SHELL_HTML" ]; then
  fail "shell.html 不存在于 apps/jowork/public/"
else
  # 提取 shell.html 中 src= 引用的 HTML 文件
  REFERENCED=$(grep -oE 'src=["\x27][^"'\'']+\.html[^"'\'']*["\x27]' "$SHELL_HTML" 2>/dev/null \
    | grep -oE '/[^"'\''?#]+\.html' | sort -u || true)

  if [ -z "$REFERENCED" ]; then
    warn "shell.html 中未找到 iframe src 引用，跳过此检查"
  else
    while IFS= read -r page; do
      # 去掉开头 /
      filename="${page#/}"
      filepath="${JOWORK_PUBLIC}/${filename}"
      if [ ! -f "$filepath" ]; then
        fail "缺少页面：apps/jowork/public/${filename}（shell.html 中有引用但文件不存在）"
        MISSING_PAGES=$((MISSING_PAGES + 1))
      fi
    done <<< "$REFERENCED"
    if [ "$MISSING_PAGES" -eq 0 ]; then
      green "所有引用页面均存在于 apps/jowork/public/"
    fi
  fi
fi

# ──────────────────────────────────────────────────────────
# CHECK 5: apps/jowork/public/ 中不存在 apps/fluxvita/ 路径引用
# ──────────────────────────────────────────────────────────
info "CHECK 5: apps/jowork/public/ 不含 apps/fluxvita 路径引用"

FV_PATH_FILES=$(grep -rl "apps/fluxvita\|packages/premium" \
  "${JOWORK_PUBLIC}" --include="*.html" --include="*.js" 2>/dev/null || true)

if [ -n "$FV_PATH_FILES" ]; then
  fail "以下文件含 apps/fluxvita 路径引用："
  echo "$FV_PATH_FILES" | sed 's/^/    /'
else
  green "无闭源路径引用"
fi

# ──────────────────────────────────────────────────────────
# 汇总
# ──────────────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════════════════════"
if [ "$ERRORS" -eq 0 ]; then
  green "全部检查通过！可以安全 push 到 GitLab（会同步至 GitHub）"
  echo "════════════════════════════════════════════════════"
  exit 0
else
  red "发现 ${ERRORS} 个问题，请修复后再 push"
  echo "════════════════════════════════════════════════════"
  echo ""
  echo "  快速修复指引："
  echo "  • token key 问题 → 将 fluxvita_token/fv_admin_token 改为 jowork_token"
  echo "  • 品牌文本问题   → 将 'FluxVita XXX' 改为 'Jowork XXX'"
  echo "  • 缺少页面问题   → 在 apps/jowork/public/ 创建对应 HTML（品牌化版本）"
  echo "  • 私有域名问题   → 移入 .env 环境变量，不硬编码在源码中"
  echo ""
  if [ "$CI_MODE" = "--ci" ]; then
    exit 1
  else
    # 本地模式：给出警告但不强制阻止（用户可选择忽略）
    echo "  ⚠ 本地模式：以上为警告，你可以强制 push，但 CI 会报错。"
    exit 0
  fi
fi
