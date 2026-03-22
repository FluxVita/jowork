#!/bin/bash
# JoWork setup script — called by skills.sh after installation
# Checks if jowork is installed and initialized, guides user through setup if not

set -e

echo ""
echo "  JoWork — AI Agent Infrastructure"
echo "  ─────────────────────────────────"
echo ""

# Check if jowork CLI is installed
if ! command -v jowork &> /dev/null; then
    echo "  Installing jowork CLI..."
    npm install -g jowork
    echo "  ✓ jowork CLI installed"
else
    echo "  ✓ jowork CLI already installed ($(jowork --version))"
fi

# Check if initialized
if [ -f "$HOME/.jowork/config.json" ]; then
    echo "  ✓ JoWork already initialized"
else
    echo ""
    echo "  Running initial setup..."
    jowork init
fi

echo ""
echo "  ✓ JoWork skill installed!"
echo ""
echo "  To connect data sources, run:"
echo "    jowork"
echo ""
