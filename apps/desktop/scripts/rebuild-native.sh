#!/bin/bash
# Rebuild native modules for system Node.js (needed after electron-builder changes them).
# Usage: pnpm run rebuild:native

set -e

SQLITE_DIR="$(cd "$(dirname "$0")/../../../node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3" 2>/dev/null && pwd)"

if [ -z "$SQLITE_DIR" ] || [ ! -d "$SQLITE_DIR" ]; then
  echo "better-sqlite3 not found in pnpm store, skipping rebuild"
  exit 0
fi

echo "Rebuilding better-sqlite3 for system Node.js ($(node -v))..."
cd "$SQLITE_DIR" && npx --yes node-gyp rebuild 2>&1 | tail -3

echo "Native modules rebuilt for $(uname -m)"
