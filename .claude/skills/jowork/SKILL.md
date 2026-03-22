---
name: jowork
version: 0.1.0
description: |
  AI Agent companion panel — connect data sources, manage sessions, drag files
  into context, track goals. Enhances Claude Code / Codex / OpenClaw with
  persistent memory, multi-source search, and a visual dashboard.
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - AskUserQuestion
---

# JoWork — Agent Infrastructure Skill

JoWork gives your AI agent eyes (data connectors), memory (cross-session persistence),
purpose (goal tracking), and a companion dashboard for visual management.

## Auto-Setup

On first use, check if JoWork is initialized:

```bash
command -v jowork >/dev/null 2>&1 && echo "CLI_INSTALLED" || echo "CLI_MISSING"
[ -d ~/.jowork ] && echo "INITIALIZED" || echo "NOT_INITIALIZED"
```

If `CLI_MISSING`: run `npm install -g jowork` (ask user first).
If `NOT_INITIALIZED`: run `jowork init`.

Then verify MCP registration:
```bash
grep -q "jowork" ~/.claude.json 2>/dev/null && echo "MCP_REGISTERED" || echo "MCP_MISSING"
```

If `MCP_MISSING`: run `jowork register claude-code`.
Tell user: "JoWork is set up. Restart Claude Code to activate MCP tools (search_data, read_memory, etc.)."

## Proactive Suggestions

When you notice the user is at these stages, suggest the appropriate action:

- User asks about team discussions, messages, or what happened → suggest `jowork sync` then use `search_data`
- User wants to search across data sources → use MCP tool `search_data` directly
- User mentions connecting Slack/GitHub/Feishu/data → suggest `/jowork-connect`
- User wants to see dashboard or manage sessions → suggest `/jowork-dashboard`
- User sets goals or wants to track metrics → suggest `jowork goal add`
- User drops a file path or mentions "index this folder" → suggest `/jowork-context`
- User asks "what's new" or wants a briefing → use MCP tool `get_briefing`

## Available Commands

- `/jowork` — Status overview + setup check
- `/jowork-connect` — Connect a data source (GitHub, Slack, Feishu, etc.)
- `/jowork-sync` — Sync all connected data sources
- `/jowork-dashboard` — Open the companion dashboard in browser
- `/jowork-context` — Add a directory to agent context

## Status Check

When invoked as `/jowork`, run:

```bash
jowork status 2>/dev/null || echo "JoWork not initialized. Run: npm install -g jowork && jowork init"
```

Show the output and suggest next actions based on what's missing:
- No data sources → suggest `/jowork-connect`
- Data sources connected but not synced recently → suggest `/jowork-sync`
- Everything healthy → suggest opening dashboard or searching data
