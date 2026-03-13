#!/bin/bash
# Rebuild better-sqlite3 for system Node.js (needed for vitest after electron-builder).
# Only rebuilds if the current binary doesn't match system Node's ABI.

set -e

SQLITE_DIR="$(cd "$(dirname "$0")/../../../node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3" 2>/dev/null && pwd)"

if [ -z "$SQLITE_DIR" ] || [ ! -d "$SQLITE_DIR" ]; then
  exit 0
fi

# Quick check: try to load the module
if node -e "require('$SQLITE_DIR')" 2>/dev/null; then
  exit 0
fi

echo "Rebuilding better-sqlite3 for system Node.js ($(node -v))..."
cd "$SQLITE_DIR" && npx --yes node-gyp rebuild 2>&1 | tail -3
echo "Done."
