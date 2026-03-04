#!/usr/bin/env bash
# Install Jowork as a macOS LaunchAgent
# Usage: bash scripts/launchagent/install.sh
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="${DATA_DIR:-$HOME/Library/Application Support/jowork}"
PLIST_DEST="$HOME/Library/LaunchAgents/work.jowork.plist"
TEMPLATE="$APP_DIR/scripts/launchagent/work.jowork.plist.template"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$DATA_DIR/logs"

sed \
  -e "s|{{APP_DIR}}|$APP_DIR|g" \
  -e "s|{{DATA_DIR}}|$DATA_DIR|g" \
  "$TEMPLATE" > "$PLIST_DEST"

# Raise file-descriptor limits for the current session as well
ulimit -n 8192 2>/dev/null || true

# Reload the agent
launchctl unload "$PLIST_DEST" 2>/dev/null || true
launchctl load "$PLIST_DEST"

echo "✓ Jowork LaunchAgent installed"
echo "  Config: $PLIST_DEST"
echo "  Data:   $DATA_DIR"
echo "  Logs:   $DATA_DIR/logs/jowork.log"
