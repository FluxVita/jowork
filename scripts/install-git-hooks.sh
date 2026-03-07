#!/usr/bin/env bash

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

git -C "${REPO_ROOT}" config core.hooksPath .githooks
chmod +x "${REPO_ROOT}/.githooks/pre-push"

echo "✓ Git hooks installed (core.hooksPath=.githooks)"
echo "  pre-push now runs check-opensource + verify-oss-runnable on main/master"

