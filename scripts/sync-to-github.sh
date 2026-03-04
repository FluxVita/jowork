#!/usr/bin/env bash
# sync-to-github.sh — Push the open-source Jowork monorepo to GitHub
#
# Usage:
#   bash scripts/sync-to-github.sh [--dry-run] [--tag v0.x.x]
#
# What it does:
#   1. Validates the working tree is clean (no uncommitted changes)
#   2. Pushes the current branch (main) to github.com/FluxVita/jowork
#   3. Optionally creates and pushes a version tag
#
# Notes:
#   - This repo IS the public open-source mirror (apps/jowork + packages/core)
#   - FluxVita-specific code (apps/fluxvita, packages/premium) is intentionally
#     included because edition-gating keeps it inert without a Premium license
#   - Sensitive credentials must NEVER appear in committed files
#
# Prerequisites:
#   - git remote "origin" must point to github.com/FluxVita/jowork.git
#   - You must have push access (SSH key or personal access token)

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_DIR"

# ── Flags ────────────────────────────────────────────────────────────────────
DRY_RUN=false
TAG=""

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --tag=*)   TAG="${arg#--tag=}" ;;
    --tag)     shift; TAG="${1:-}" ;;
  esac
done

# ── Helpers ──────────────────────────────────────────────────────────────────
info()  { echo "  ℹ  $*"; }
ok()    { echo "  ✅ $*"; }
err()   { echo "  ❌ $*" >&2; exit 1; }
dryrun(){ echo "  🔸 [dry-run] $*"; }

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  Jowork → GitHub sync                                    ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""

# ── Validate remote ──────────────────────────────────────────────────────────
REMOTE_URL="$(git remote get-url origin 2>/dev/null || true)"
if [[ -z "$REMOTE_URL" ]]; then
  err "No 'origin' remote found. Add it with:
  git remote add origin https://github.com/FluxVita/jowork.git"
fi
info "Remote: $REMOTE_URL"

# ── Check working tree ───────────────────────────────────────────────────────
if [[ -n "$(git status --porcelain)" ]]; then
  err "Working tree has uncommitted changes. Commit or stash before syncing."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
COMMIT="$(git rev-parse --short HEAD)"
info "Branch: $BRANCH  Commit: $COMMIT"

# ── Security scan: no secrets ────────────────────────────────────────────────
info "Scanning for potential secrets..."
SUSPICIOUS_PATTERNS=(
  'ANTHROPIC_API_KEY\s*=\s*sk-'
  'Authorization:\s*Bearer\s+[A-Za-z0-9_\-]{20,}'
  'password\s*=\s*["\x27][^"\x27]{6,}'
)
FOUND_SECRETS=false
for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
  if git grep -qiP "$pattern" -- ':!*.sh' ':!*.md' 2>/dev/null; then
    echo "  ⚠️  Potential secret found matching: $pattern"
    FOUND_SECRETS=true
  fi
done
if $FOUND_SECRETS; then
  err "Secrets detected. Remove them before pushing to a public repository."
fi
ok "No secrets found"

# ── Push branch ──────────────────────────────────────────────────────────────
if $DRY_RUN; then
  dryrun "git push origin $BRANCH"
else
  info "Pushing $BRANCH to origin..."
  git push origin "$BRANCH"
  ok "Pushed $BRANCH"
fi

# ── Push tag (optional) ──────────────────────────────────────────────────────
if [[ -n "$TAG" ]]; then
  if git tag | grep -qx "$TAG"; then
    info "Tag $TAG already exists locally"
  else
    info "Creating tag $TAG..."
    if $DRY_RUN; then
      dryrun "git tag -a $TAG -m \"Release $TAG\""
    else
      git tag -a "$TAG" -m "Release $TAG"
      ok "Created tag $TAG"
    fi
  fi

  if $DRY_RUN; then
    dryrun "git push origin $TAG"
  else
    info "Pushing tag $TAG..."
    git push origin "$TAG"
    ok "Pushed tag $TAG"
  fi
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "  📦 Recent commits pushed:"
git log --oneline -5 | sed 's/^/     /'
echo ""
if $DRY_RUN; then
  echo "  🔸 Dry-run complete — no changes were pushed"
else
  echo "  ✅ Sync complete → $REMOTE_URL"
fi
echo ""
