#!/usr/bin/env bash
# Remove Jowork LaunchAgent
set -euo pipefail

PLIST="$HOME/Library/LaunchAgents/work.jowork.plist"

if [[ -f "$PLIST" ]]; then
  launchctl unload "$PLIST" 2>/dev/null || true
  rm "$PLIST"
  echo "✓ Jowork LaunchAgent removed"
else
  echo "LaunchAgent not found at $PLIST (already uninstalled?)"
fi
