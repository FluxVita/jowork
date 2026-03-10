#!/usr/bin/env bash
# test-all.sh — 分阶段测试运行器
#
# 用法:
#   bash scripts/test-all.sh           # 跑 Phase 1-4（日常开发）
#   bash scripts/test-all.sh --full    # 跑 Phase 1-5（大版本发布）
#   bash scripts/test-all.sh --phase 3 # 只跑指定阶段
#
# Phase 1: 静态检查 (lint)            ~30s  无需 Gateway
# Phase 2: 单元测试                    ~10s  无需 Gateway
# Phase 3: API 契约测试               ~30s  需要 Gateway
# Phase 4: 冒烟测试                    ~2min 需要 Gateway
# Phase 5: 完整 E2E（仅 --full 触发） ~5min 需要 Gateway
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

# ── 参数解析 ──
RUN_FULL=false
ONLY_PHASE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --full)  RUN_FULL=true; shift ;;
    --phase) ONLY_PHASE="$2"; shift 2 ;;
    *)       echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── 颜色 ──
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
SKIP=0

run_phase() {
  local phase="$1" name="$2"
  shift 2

  if [[ -n "$ONLY_PHASE" && "$ONLY_PHASE" != "$phase" ]]; then
    echo -e "${YELLOW}⊘ Phase $phase: $name — skipped${NC}"
    ((SKIP++)) || true
    return 0
  fi

  echo ""
  echo -e "${BOLD}━━━ Phase $phase: $name ━━━${NC}"
  if "$@"; then
    echo -e "${GREEN}✓ Phase $phase passed${NC}"
    ((PASS++)) || true
  else
    echo -e "${RED}✗ Phase $phase FAILED${NC}"
    ((FAIL++)) || true
  fi
}

# ── 服务管理（Phase 3+ 需要 Gateway 运行） ──
FV_PID=""
JW_PID=""
SERVERS_STARTED=false

start_servers() {
  if $SERVERS_STARTED; then return 0; fi

  # 检查 Gateway 是否已经在运行
  if curl -sSf http://localhost:18800/health >/dev/null 2>&1; then
    echo -e "${YELLOW}ℹ FluxVita Gateway 已在运行（端口 18800）${NC}"
  else
    echo "▶ 编译项目..."
    npm run build --silent

    echo "▶ 启动 FluxVita Gateway (18800)..."
    node apps/fluxvita/dist/index.js > /tmp/fluxvita-test.log 2>&1 &
    FV_PID=$!

    # 等待 /health
    for i in $(seq 1 30); do
      if curl -sSf http://localhost:18800/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓ FluxVita Gateway is up${NC}"
        break
      fi
      if [[ $i -eq 30 ]]; then
        echo -e "${RED}✗ FluxVita Gateway failed to start. Logs:${NC}"
        tail -20 /tmp/fluxvita-test.log
        exit 1
      fi
      sleep 1
    done
  fi

  # 启动 Jowork E2E 静态服务器（代理 API 到 FluxVita）
  if curl -sSf http://localhost:18810/health >/dev/null 2>&1; then
    echo -e "${YELLOW}ℹ Jowork E2E 服务器已在运行（端口 18810）${NC}"
  else
    echo "▶ 启动 Jowork E2E 服务器 (18810)..."
    node tests/e2e/jowork-server.mjs > /tmp/jowork-test.log 2>&1 &
    JW_PID=$!

    for i in $(seq 1 15); do
      if curl -sSf http://localhost:18810/health >/dev/null 2>&1; then
        echo -e "${GREEN}✓ Jowork E2E server is up${NC}"
        break
      fi
      if [[ $i -eq 15 ]]; then
        echo -e "${YELLOW}⚠ Jowork E2E server may not be ready (non-critical)${NC}"
        break
      fi
      sleep 1
    done
  fi

  SERVERS_STARTED=true
}

cleanup() {
  if [[ -n "$FV_PID" ]]; then
    echo "▶ Shutting down FluxVita (pid=$FV_PID)"
    kill "$FV_PID" 2>/dev/null || true
  fi
  if [[ -n "$JW_PID" ]]; then
    echo "▶ Shutting down Jowork E2E server (pid=$JW_PID)"
    kill "$JW_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# ═══════════════════════════════════════════
# Phase 1: 静态检查
# ═══════════════════════════════════════════
run_phase 1 "静态检查 (lint)" npm run lint || true

# ═══════════════════════════════════════════
# Phase 2: 单元测试
# ═══════════════════════════════════════════
run_phase 2 "单元测试" npm test || true

# ═══════════════════════════════════════════
# Phase 3: API 契约测试（需要 Gateway）
# ═══════════════════════════════════════════
needs_server() {
  [[ -z "$ONLY_PHASE" || "$ONLY_PHASE" == "$1" ]]
}

if needs_server 3 || needs_server 4 || needs_server 5; then
  start_servers
fi

run_phase 3 "API 契约测试" npm run test:pw:contract || true

# ═══════════════════════════════════════════
# Phase 4: 冒烟测试
# ═══════════════════════════════════════════
run_phase 4 "冒烟测试" npm run test:pw:smoke || true

# ═══════════════════════════════════════════
# Phase 5: 完整 E2E（仅 --full 触发）
# ═══════════════════════════════════════════
if $RUN_FULL; then
  run_phase 5 "完整 E2E" npm run test:pw || true
else
  if [[ -z "$ONLY_PHASE" || "$ONLY_PHASE" == "5" ]]; then
    echo ""
    echo -e "${YELLOW}⊘ Phase 5: 完整 E2E — skipped (use --full to run)${NC}"
    ((SKIP++)) || true
  fi
fi

# ═══════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${GREEN}✓ Passed: $PASS${NC}  ${RED}✗ Failed: $FAIL${NC}  ${YELLOW}⊘ Skipped: $SKIP${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}测试失败，请修复后重试${NC}"
  exit 1
fi

echo -e "${GREEN}所有测试通过！${NC}"
