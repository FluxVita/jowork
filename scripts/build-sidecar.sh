#!/usr/bin/env bash
# Build the Jowork Gateway sidecar binary using Bun --compile.
# Output: apps/jowork/src-tauri/binaries/jowork-gateway-{target}
#
# The sidecar uses bun:sqlite (built into Bun) instead of better-sqlite3,
# so no native addon shipping is required — truly single-file binary.
#
# Usage:
#   ./scripts/build-sidecar.sh              # Build for current platform
#   ./scripts/build-sidecar.sh --target bun-darwin-arm64   # Cross-compile

set -euo pipefail
cd "$(dirname "$0")/.."

# ── Detect target triple ──
if [[ "${1:-}" == "--target" && -n "${2:-}" ]]; then
  BUN_TARGET="$2"
else
  ARCH=$(uname -m)
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')

  case "$OS" in
    darwin) OS_TAG="darwin" ;;
    linux)  OS_TAG="linux" ;;
    *)      echo "Unsupported OS: $OS"; exit 1 ;;
  esac

  case "$ARCH" in
    arm64|aarch64) ARCH_TAG="arm64" ;;
    x86_64)        ARCH_TAG="x64" ;;
    *)             echo "Unsupported arch: $ARCH"; exit 1 ;;
  esac

  BUN_TARGET="bun-${OS_TAG}-${ARCH_TAG}"
fi

# Tauri expects sidecar name to include target triple
case "$BUN_TARGET" in
  bun-darwin-arm64) TAURI_TRIPLE="aarch64-apple-darwin" ;;
  bun-darwin-x64)   TAURI_TRIPLE="x86_64-apple-darwin" ;;
  bun-linux-arm64)  TAURI_TRIPLE="aarch64-unknown-linux-gnu" ;;
  bun-linux-x64)    TAURI_TRIPLE="x86_64-unknown-linux-gnu" ;;
  *)                TAURI_TRIPLE="$BUN_TARGET" ;;
esac

OUTDIR="apps/jowork/src-tauri/binaries"
OUTNAME="jowork-gateway-${TAURI_TRIPLE}"
mkdir -p "$OUTDIR"

echo "╭──────────────────────────────────────╮"
echo "│  Building Jowork Gateway Sidecar     │"
echo "│  Target: $BUN_TARGET"
echo "│  Output: $OUTDIR/$OUTNAME"
echo "╰──────────────────────────────────────╯"

# ── Step 1: Build TypeScript ──
echo "→ Compiling TypeScript..."
pnpm --filter @jowork/core build
pnpm --filter @jowork/app build

# ── Step 2: Compile with Bun ──
# --external better-sqlite3: the sidecar uses bun:sqlite via setDb() injection,
# so better-sqlite3 is never actually called at runtime. We exclude it to avoid
# bundling the native addon resolution code.
echo "→ Compiling sidecar binary with Bun..."
bun build \
  --compile \
  --target "$BUN_TARGET" \
  --external better-sqlite3 \
  --outfile "$OUTDIR/$OUTNAME" \
  apps/jowork/dist/sidecar.js

# ── Step 3: Verify ──
if [[ -f "$OUTDIR/$OUTNAME" ]]; then
  SIZE=$(du -sh "$OUTDIR/$OUTNAME" | cut -f1)
  echo ""
  echo "✓ Sidecar binary built: $OUTDIR/$OUTNAME ($SIZE)"
  echo "  Tauri triple: $TAURI_TRIPLE"
else
  echo "✗ Build failed — output file not found"
  exit 1
fi
