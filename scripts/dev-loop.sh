#!/usr/bin/env bash
# Autonomous development loop for Jowork
# Runs Claude Code sessions continuously until time limit or all tasks done.

set -euo pipefail

# ── Config ────────────────────────────────────────────────────────────────────
MAX_CYCLES="${MAX_CYCLES:-99}"          # Max task cycles per run
CYCLE_PAUSE="${CYCLE_PAUSE:-15}"        # Seconds between cycles
SESSION_MINUTES="${SESSION_MINUTES:-330}" # ~5.5 hours, leaves buffer before GH timeout
PROMPT_FILE=".github/prompts/autonomous-dev.md"

# ── Setup ─────────────────────────────────────────────────────────────────────
END_TIME=$(( $(date +%s) + SESSION_MINUTES * 60 ))
CYCLE=0

git config user.name  "Claude Code [bot]"
git config user.email "claude-bot@fluxvita.com"

echo "╔══════════════════════════════════════════════════════╗"
echo "║  Jowork Autonomous Dev Loop                          ║"
echo "║  Session: ${SESSION_MINUTES}min  Max cycles: ${MAX_CYCLES}           ║"
echo "║  End time: $(date -d "@$END_TIME" 2>/dev/null || date -r "$END_TIME" 2>/dev/null || echo 'calculated')          ║"
echo "╚══════════════════════════════════════════════════════╝"

# Install pnpm if needed
if ! command -v pnpm &>/dev/null; then
  npm install -g pnpm@latest --silent
fi

# Install dependencies if package.json exists
if [ -f "pnpm-workspace.yaml" ] || [ -f "package.json" ]; then
  echo "📦 Installing dependencies..."
  pnpm install --frozen-lockfile 2>/dev/null || pnpm install || true
fi

# ── Main loop ─────────────────────────────────────────────────────────────────
while true; do
  CYCLE=$(( CYCLE + 1 ))
  NOW=$(date +%s)

  # Time check
  if [ "$NOW" -ge "$END_TIME" ]; then
    echo "⏰ Session time limit reached after $CYCLE cycles. Stopping gracefully."
    break
  fi

  # Max cycles check
  if [ "$CYCLE" -gt "$MAX_CYCLES" ]; then
    echo "🔢 Max cycles ($MAX_CYCLES) reached. Stopping."
    break
  fi

  REMAINING=$(( (END_TIME - NOW) / 60 ))
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "🤖 Cycle $CYCLE | $(date '+%H:%M:%S') | ${REMAINING}min remaining"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Pull latest changes (other AI instances may have pushed)
  git pull --rebase origin main 2>/dev/null || true

  # Run Claude Code (non-interactive)
  CLAUDE_EXIT=0
  claude \
    --dangerously-skip-permissions \
    --max-turns 150 \
    -p "$(cat "$PROMPT_FILE")" \
    2>&1 || CLAUDE_EXIT=$?

  if [ "$CLAUDE_EXIT" -ne 0 ]; then
    echo "⚠️  Claude exited with code $CLAUDE_EXIT — pausing ${CYCLE_PAUSE}s before retry"
    sleep "$CYCLE_PAUSE"
    continue
  fi

  # Check for uncommitted changes
  if [ -n "$(git status --porcelain)" ]; then
    echo "📝 Changes detected, committing..."
    git add -A

    # Build commit message from what changed
    CHANGED=$(git diff --cached --name-only | head -5 | tr '\n' ' ')
    git commit -m "feat(ai-dev): cycle $CYCLE — $CHANGED

[skip ci: false]
Automated commit from Claude Code autonomous dev loop.
Session: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

    git push origin main
    echo "✅ Pushed cycle $CYCLE changes"
  else
    echo "ℹ️  No file changes this cycle"
    # Check if all tasks are done
    if grep -q "⏳ 未开始\|\[ \] " docs/JOWORK-PLAN.md 2>/dev/null; then
      echo "📋 Tasks remain — continuing"
    else
      echo "🎉 All tasks appear complete!"
      break
    fi
  fi

  echo "💤 Pausing ${CYCLE_PAUSE}s..."
  sleep "$CYCLE_PAUSE"
done

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║  Session complete. Total cycles: $CYCLE               ║"
echo "╚══════════════════════════════════════════════════════╝"
git log --oneline -10
