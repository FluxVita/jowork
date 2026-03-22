---
name: jowork-context
version: 0.1.0
description: |
  Add a local directory to your agent's context. Files are indexed into JoWork's
  database and become searchable via search_data MCP tool.
allowed-tools:
  - Bash
  - AskUserQuestion
---

# /jowork-context — Add Directory to Context

Index a local directory so your agent can search its contents.

## Flow

1. If no directory specified, ask:
   "Which directory should I index? (e.g., ~/project/src, ./lib)"

2. Index the directory:
```bash
jowork context add "<directory_path>" 2>&1
```

If `jowork context` command doesn't exist yet, use the dashboard API directly:
```bash
CSRF=$(curl -s http://127.0.0.1:$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)/ 2>/dev/null | grep csrf-token | sed 's/.*content="\([^"]*\)".*/\1/')
curl -s -X POST "http://127.0.0.1:$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)/api/context" \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: $CSRF" \
  -d "{\"type\":\"directory\",\"value\":\"$(realpath "$1")\",\"label\":\"$(basename "$1")\"}"
```

3. Report: "Indexed N files from <directory>. Your agent can now find these files with search_data."

## Skip Rules
- .git, node_modules, .DS_Store — skipped
- Binary files (.png, .exe, .zip, etc.) — skipped
- Files > 1MB — skipped
- Directories deeper than 10 levels — truncated
