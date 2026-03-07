#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXCLUDE_FILE="${REPO_ROOT}/scripts/oss-sync-excludes.txt"
TMP_DIR="$(mktemp -d /tmp/jowork-oss-verify-XXXXXX)"
PORT="18990"
LOG_FILE="${TMP_DIR}/oss-smoke.log"
APP_PID=""

cleanup() {
  if [ -n "${APP_PID}" ] && kill -0 "${APP_PID}" 2>/dev/null; then
    kill "${APP_PID}" 2>/dev/null || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "▶ Preparing OSS view in ${TMP_DIR}"

if [ ! -f "${EXCLUDE_FILE}" ]; then
  echo "✗ Missing exclude file: ${EXCLUDE_FILE}"
  exit 1
fi

rsync -av --delete \
  --exclude-from="${EXCLUDE_FILE}" \
  "${REPO_ROOT}/" "${TMP_DIR}/" >/dev/null

cd "${TMP_DIR}"

command -v pnpm >/dev/null 2>&1 || npm install -g pnpm

echo "▶ Installing dependencies"
pnpm install --frozen-lockfile

echo "▶ Building OSS packages"
pnpm --filter @jowork/core build
pnpm --filter @jowork/app build

echo "▶ Running smoke server check"
JWT_SECRET="ci-oss-smoke-secret" GATEWAY_PORT="${PORT}" node apps/jowork/dist/index.js >"${LOG_FILE}" 2>&1 &
APP_PID="$!"

for _ in {1..20}; do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    echo "✓ OSS view is runnable"
    exit 0
  fi
  sleep 1
done

echo "✗ OSS smoke check failed, recent logs:"
tail -n 80 "${LOG_FILE}" || true
exit 1
