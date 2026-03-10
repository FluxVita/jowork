#!/usr/bin/env bash
# e2e-full.sh — 完整 E2E 测试（自动启动双 Gateway）
#
# 启动 FluxVita Gateway (18800) + Jowork E2E 静态服务器 (18810)，
# 然后运行完整 Playwright 测试套件。
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

FV_PID=""
JW_PID=""

cleanup() {
  echo "▶ Shutting down servers"
  [[ -n "$FV_PID" ]] && kill "$FV_PID" 2>/dev/null || true
  [[ -n "$JW_PID" ]] && kill "$JW_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▶ Building packages"
npm run build --silent

# ── FluxVita Gateway ──
if curl -sSf http://localhost:18800/health >/dev/null 2>&1; then
  echo "ℹ FluxVita Gateway already running (18800)"
else
  echo "▶ Starting FluxVita Gateway (18800)"
  node apps/fluxvita/dist/index.js > /tmp/fluxvita-e2e.log 2>&1 &
  FV_PID=$!

  echo "▶ Waiting for FluxVita /health"
  for i in $(seq 1 60); do
    if curl -sSf http://localhost:18800/health >/dev/null 2>&1; then
      echo "✓ FluxVita Gateway is up"
      break
    fi
    if [[ $i -eq 60 ]]; then
      echo "✗ FluxVita Gateway failed to start. Logs:"
      tail -20 /tmp/fluxvita-e2e.log
      exit 1
    fi
    sleep 1
  done
fi

# ── Jowork E2E 服务器 ──
if curl -sSf http://localhost:18810/health >/dev/null 2>&1; then
  echo "ℹ Jowork E2E server already running (18810)"
else
  echo "▶ Starting Jowork E2E server (18810)"
  node tests/e2e/jowork-server.mjs > /tmp/jowork-e2e.log 2>&1 &
  JW_PID=$!

  echo "▶ Waiting for Jowork /health"
  for i in $(seq 1 15); do
    if curl -sSf http://localhost:18810/health >/dev/null 2>&1; then
      echo "✓ Jowork E2E server is up"
      break
    fi
    if [[ $i -eq 15 ]]; then
      echo "⚠ Jowork E2E server may not be ready (continuing anyway)"
    fi
    sleep 1
  done
fi

echo ""
echo "▶ Running Playwright tests"
npm run test:pw

echo ""
echo "▶ Done."
echo "  FluxVita logs: /tmp/fluxvita-e2e.log"
echo "  Jowork logs:   /tmp/jowork-e2e.log"
