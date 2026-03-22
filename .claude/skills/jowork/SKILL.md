---
name: jowork
version: 0.2.0
description: |
  AI Agent companion — connect data sources, manage sessions, drag files into
  context, track goals. Works with Claude Code, Codex, and OpenClaw.
  Use /jowork for status, or just ask naturally ("connect my GitHub", "sync data",
  "open dashboard", "search PRs").
allowed-tools:
  - Bash
  - Read
  - AskUserQuestion
---

# JoWork — Agent Infrastructure

JoWork gives your AI agent data awareness (connectors), memory (cross-session),
goal tracking, and a companion dashboard. All data stays local.

## How it works

JoWork runs as an MCP server. Your agent already has these tools available:
- **search_data** — search across all synced data
- **read_memory / write_memory** — cross-session memory
- **search_memory** — time-weighted memory search
- **get_goals / get_metrics** — goal progress
- **get_hot_context** — recent 24-72h activity summary
- **get_briefing** — daily briefing
- **sync_now** — trigger data sync
- **push_to_channel** — send messages to connected channels

Use these MCP tools directly. No slash commands needed for data queries.

## When the user asks to connect a data source

Run the appropriate bash command. Ask for credentials via AskUserQuestion
if not in environment. Never display tokens in output.

\`\`\`
GitHub:   jowork connect github --token "$GITHUB_PERSONAL_ACCESS_TOKEN"
GitLab:   jowork connect gitlab --token "<token>"
Linear:   jowork connect linear --api-key "<key>"
PostHog:  jowork connect posthog --api-key "<key>" --project-id "<id>"
Feishu:   jowork connect feishu --app-id "<id>" --app-secret "<secret>"
\`\`\`

After connecting, call the \`sync_now\` MCP tool or run \`jowork sync\`.

## When the user asks to open the dashboard

\`\`\`bash
PORT=$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)
if curl -s --max-time 1 "http://127.0.0.1:$PORT/api/status" >/dev/null 2>&1; then
  open "http://127.0.0.1:$PORT" 2>/dev/null || echo "Open http://127.0.0.1:$PORT"
else
  jowork dashboard &
  sleep 2
  open "http://127.0.0.1:$(cat ~/.jowork/dashboard.port 2>/dev/null || echo 18801)"
fi
\`\`\`

## When the user asks to index a folder

\`\`\`bash
jowork context add "<directory_path>"
\`\`\`

Or if dashboard is running, use its API for progress feedback.

## Proactive behavior

When you notice these patterns, act without being asked:
- User asks about team discussions → call \`search_data\` or \`get_hot_context\`
- User mentions connecting a service → guide through connection (see above)
- User asks "what's new" or wants a briefing → call \`get_briefing\`
- User mentions a folder to index → offer to index it
- User wants to track a metric → guide through \`jowork goal add\`

## Status check (when invoked as /jowork)

\`\`\`bash
jowork status 2>/dev/null || echo "Not initialized. Run: npx jowork@latest setup"
\`\`\`

Show results and suggest next action based on state.
