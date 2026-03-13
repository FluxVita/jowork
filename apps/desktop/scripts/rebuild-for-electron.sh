#!/bin/bash
# Rebuild better-sqlite3 for Electron (needed before electron-vite dev).
# Only rebuilds if the current binary doesn't match Electron's ABI.

set -eo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DESKTOP_DIR="$(dirname "$SCRIPT_DIR")"
REPO_ROOT="$(cd "$DESKTOP_DIR/../.." && pwd)"

# Resolve electron version from the desktop package's dependency
ELECTRON_VERSION=$(cd "$DESKTOP_DIR" && node -e "console.log(require('electron/package.json').version)" 2>/dev/null || echo "")
if [ -z "$ELECTRON_VERSION" ]; then
  echo "[rebuild] electron not found, skipping"
  exit 0
fi

SQLITE_DIR="$REPO_ROOT/node_modules/.pnpm/better-sqlite3@12.6.2/node_modules/better-sqlite3"
if [ ! -d "$SQLITE_DIR" ]; then
  echo "[rebuild] better-sqlite3 not found, skipping"
  exit 0
fi

# Quick check: can Electron load the current binary (must instantiate to trigger native load)?
ELECTRON_BIN="$(cd "$DESKTOP_DIR" && node -e "console.log(require('electron'))" 2>/dev/null || echo "")"
if [ -n "$ELECTRON_BIN" ] && "$ELECTRON_BIN" --no-sandbox -e "new (require('$SQLITE_DIR'))(':memory:').close()" 2>/dev/null; then
  echo "[rebuild] better-sqlite3 already compatible with Electron $ELECTRON_VERSION"
  exit 0
fi

# Rebuild for Electron
echo "[rebuild] Rebuilding better-sqlite3 for Electron v${ELECTRON_VERSION}..."
ARCH="$(uname -m | sed 's/x86_64/x64/;s/aarch64/arm64/')"
cd "$SQLITE_DIR"
HOME=~/.electron-gyp npx --yes node-gyp rebuild \
  --target="$ELECTRON_VERSION" \
  --arch="$ARCH" \
  --dist-url=https://electronjs.org/headers \
  --runtime=electron 2>&1 | tail -5

# Verify it actually works now
if [ -n "$ELECTRON_BIN" ] && "$ELECTRON_BIN" --no-sandbox -e "new (require('$SQLITE_DIR'))(':memory:').close()" 2>/dev/null; then
  echo "[rebuild] Success — better-sqlite3 ready for Electron $ELECTRON_VERSION"
else
  echo "[rebuild] WARNING: rebuild completed but verification failed"
fi
