#!/bin/bash
# Rebuild better-sqlite3 for system Node.js (needed for vitest after electron-builder).
# Only rebuilds if the current binary doesn't match system Node's ABI.

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

SQLITE_DIR="$REPO_ROOT/node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3"
if [ ! -d "$SQLITE_DIR" ]; then
  exit 0
fi

# Quick check: actually instantiate a Database to verify the native binary loads
if node -e "new (require('$SQLITE_DIR'))(':memory:').close()" 2>/dev/null; then
  exit 0
fi

echo "[rebuild] Rebuilding better-sqlite3 for system Node.js ($(node -v))..."
cd "$SQLITE_DIR" && npx --yes node-gyp rebuild 2>&1 | tail -5
echo "[rebuild] Done."
