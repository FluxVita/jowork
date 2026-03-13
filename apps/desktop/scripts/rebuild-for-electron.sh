#!/bin/bash
# Rebuild better-sqlite3 for Electron (needed before electron-vite dev).
# Only rebuilds if the current binary doesn't match Electron's ABI.

set -e

ELECTRON_VERSION=$(node -e "console.log(require('electron/package.json').version)" 2>/dev/null || echo "")
if [ -z "$ELECTRON_VERSION" ]; then
  exit 0
fi

SQLITE_DIR="$(cd "$(dirname "$0")/../../../node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3" 2>/dev/null && pwd)"
if [ -z "$SQLITE_DIR" ] || [ ! -d "$SQLITE_DIR" ]; then
  exit 0
fi

# Quick check: try to load with Electron's node
ELECTRON_BIN="$(node -e "console.log(require('electron'))" 2>/dev/null || echo "")"
if [ -n "$ELECTRON_BIN" ] && "$ELECTRON_BIN" --no-sandbox -e "require('$SQLITE_DIR')" 2>/dev/null; then
  exit 0
fi

# Can't easily test Electron ABI without launching Electron, so check if system Node can load it.
# If system Node CAN load it, it's the wrong ABI for Electron (they differ).
if node -e "require('$SQLITE_DIR')" 2>/dev/null; then
  echo "Rebuilding better-sqlite3 for Electron v${ELECTRON_VERSION}..."
  ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
  cd "$SQLITE_DIR" && npx --yes node-gyp rebuild --target="$ELECTRON_VERSION" --arch="$ARCH" --dist-url=https://electronjs.org/headers 2>&1 | tail -3
  echo "Done."
fi
