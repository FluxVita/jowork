#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

echo "▶ Building packages"
npm run build --silent

echo "▶ Starting FluxVita server (18800)"
node apps/fluxvita/dist/index.js > /tmp/fluxvita-e2e.log 2>&1 &
PID=$!

cleanup() {
  echo "▶ Shutting down (pid=$PID)"
  kill "$PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "▶ Waiting for /health"
for i in $(seq 1 60); do
  if curl -sSf http://localhost:18800/health >/dev/null 2>&1; then
    echo "✓ Server is up"; break; fi; sleep 1; done

echo "▶ Running Playwright tests"
npm run test:pw

echo "▶ Done. Logs: /tmp/fluxvita-e2e.log"

