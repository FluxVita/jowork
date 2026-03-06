#!/bin/bash
#
# sanitize-for-oss.sh — 开源清理检查脚本
#
# 用途：在同步到 GitHub 前，扫描 packages/core 和 apps/jowork 中的敏感信息。
# 输出：pass/fail + 需手动检查的文件列表
#
# 使用方式：
#   bash scripts/sanitize-for-oss.sh           # 扫描并输出报告
#   bash scripts/sanitize-for-oss.sh --fix     # 输出报告（不自动修复，人工处理）

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 仅扫描同步到 GitHub 的目录
SCAN_DIRS=(
  "$REPO_ROOT/packages/core/src"
  "$REPO_ROOT/apps/jowork/src"
  "$REPO_ROOT/apps/jowork/public"
)

RED='\033[0;31m'
YEL='\033[1;33m'
GRN='\033[0;32m'
RST='\033[0m'

FAIL=0
WARN=0

log_fail() { echo -e "${RED}[FAIL]${RST} $*"; FAIL=$((FAIL+1)); }
log_warn() { echo -e "${YEL}[WARN]${RST} $*"; WARN=$((WARN+1)); }
log_ok()   { echo -e "${GRN}[ OK ]${RST} $*"; }

echo "=== Jowork 开源安全扫描 ==="
echo "扫描目录: ${SCAN_DIRS[*]}"
echo ""

# ── 1. 确认 .env 不在 git 中 ───────────────────────────────────────────────────

if git -C "$REPO_ROOT" ls-files --error-unmatch .env &>/dev/null 2>&1; then
  log_fail ".env 文件在 git 中！立即从版本控制中移除：git rm --cached .env"
else
  log_ok ".env 未被追踪"
fi

# ── 2. 扫描高危模式：真实凭证 ──────────────────────────────────────────────────

echo ""
echo "── 2. 高危：硬编码凭证 ──"

PATTERNS=(
  # Aiden/FluxVita 内部 ID
  "ou_f122e52140cd4e6e9e9456d801786145"
  # FluxVita GitLab
  "gitlab\.fluxvitae\.com"
  # FluxVita 公网域名
  "gateway\.fluxvita\.work"
  "frp-rug\.com"
  # FluxVita Feishu 租户
  "fluxvita\.feishu\.cn"
  # FluxVita 特有 API key 前缀（非示例）
  "glpat-[A-Za-z0-9_-]{20}"
  # 飞书 AppID 格式（真实 ID）
  "cli_a92874fba4789cd9"
  # PostHog 硬编码项目 ID（纯数字 + 注释中出现的 Jovida）
  "Jovida project"
)

for pattern in "${PATTERNS[@]}"; do
  for dir in "${SCAN_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    matches=$(grep -rn --include="*.ts" --include="*.js" --include="*.html" \
      "$pattern" "$dir" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      log_fail "发现高危模式 '$pattern':"
      echo "$matches" | sed 's/^/    /'
    fi
  done
done

# ── 3. 扫描中危模式：品牌字符串 ──────────────────────────────────────────────

echo ""
echo "── 3. 中危：品牌字符串 ──"

BRAND_PATTERNS=(
  "FluxVita"
  "fluxvita"
  "fluxvitae"
  "jovida-logo"
  "Jovida AI"
  "jovida_uid"
  "FluxVita AI Agent"
  "ai-agent@fluxvita"
)

for pattern in "${BRAND_PATTERNS[@]}"; do
  for dir in "${SCAN_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    matches=$(grep -rn --include="*.ts" --include="*.js" --include="*.html" \
      "$pattern" "$dir" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      log_warn "品牌字符串 '$pattern':"
      echo "$matches" | sed 's/^/    /'
    fi
  done
done

# ── 4. 验证 .env.example 存在且不含真实凭证 ────────────────────────────────────

echo ""
echo "── 4. .env.example 检查 ──"

if [ -f "$REPO_ROOT/.env.example" ]; then
  log_ok ".env.example 存在"
  # 检查是否含真实 API key 格式
  if grep -E "glpat-[A-Za-z0-9_-]{20}|sk-[A-Za-z0-9]{48}|cli_[a-z0-9]{16}" \
    "$REPO_ROOT/.env.example" &>/dev/null; then
    log_fail ".env.example 疑似含真实 API key！"
  else
    log_ok ".env.example 无真实 API key"
  fi
else
  log_fail ".env.example 不存在，请创建"
fi

# ── 5. 检查 IP 地址（内网/特定 IP）───────────────────────────────────────────

echo ""
echo "── 5. 硬编码 IP 地址检查 ──"

IP_PATTERNS=(
  "100\.[0-9]+\.[0-9]+\.[0-9]+"   # Tailscale IP 段
  "192\.168\.[0-9]+\.[0-9]+"      # 内网 IP
)

for pattern in "${IP_PATTERNS[@]}"; do
  for dir in "${SCAN_DIRS[@]}"; do
    [ -d "$dir" ] || continue
    matches=$(grep -rn --include="*.ts" --include="*.js" --include="*.html" \
      -E "$pattern" "$dir" 2>/dev/null || true)
    if [ -n "$matches" ]; then
      log_warn "疑似内网 IP '$pattern':"
      echo "$matches" | sed 's/^/    /'
    fi
  done
done

# ── 汇总 ───────────────────────────────────────────────────────────────────────

echo ""
echo "=== 扫描结果 ==="
if [ "$FAIL" -eq 0 ] && [ "$WARN" -eq 0 ]; then
  echo -e "${GRN}✓ 全部通过，无问题${RST}"
elif [ "$FAIL" -eq 0 ]; then
  echo -e "${YEL}⚠ 通过（有 $WARN 个警告需要确认）${RST}"
else
  echo -e "${RED}✗ 发现 $FAIL 个高危问题 + $WARN 个警告，请修复后再同步${RST}"
  exit 1
fi
