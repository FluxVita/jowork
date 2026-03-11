---
name: jowork
description: "Access your team's data through JoWork Gateway — search Feishu docs, create GitLab MRs, query PostHog, send Lark messages, and more."
metadata:
  openclaw:
    emoji: "🔗"
    requires:
      bins: ["node"]
      env: ["JOWORK_URL", "JOWORK_TOKEN"]
    install:
      - id: npm
        kind: node
        package: "@jowork/mcp-server"
        bins: ["jowork-mcp"]
---

# JoWork — Team Data Gateway

Access your team's structured data through JoWork Gateway. Search across Feishu docs, GitLab repos, Linear issues, PostHog analytics, and more — all from your AI assistant.

## When to Use

✅ Searching company documents ("find the Q2 OKR doc in Feishu")
✅ Creating GitLab merge requests
✅ Querying PostHog user behavior data
✅ Sending Feishu/Lark messages
✅ Checking connected data sources
✅ Reading/writing agent memory

❌ Local file operations (use built-in tools)
❌ Web browsing (use browser tools)
❌ Direct database access (use run_query through Gateway)

## Setup

1. Deploy JoWork Gateway or use the hosted version at https://jowork.work
2. Get a JWT token (from web UI or API)
3. Set environment variables:

```bash
export JOWORK_URL="https://jowork.work"
export JOWORK_TOKEN="<your-jwt>"
```

4. Run: `jowork-mcp` (stdio MCP server)

## Common Commands

```bash
# Start MCP server (stdio mode, for MCP clients)
jowork-mcp

# Test connection
JOWORK_URL=https://jowork.work JOWORK_TOKEN=xxx jowork-mcp
```

## Available Tools

- `jowork_search_data` — Full-text search across all connected data sources
- `jowork_fetch_content` — Get full document content by URI
- `jowork_create_gitlab_mr` — Create branches, commits, and merge requests
- `jowork_query_posthog` — Query user behavior analytics
- `jowork_lark_send_message` — Send messages to Feishu chats
- `jowork_lark_list_chats` — List your Feishu group chats
- `jowork_lark_create_calendar_event` — Create calendar events
- `jowork_read_memory` / `jowork_write_memory` — Persistent agent memory

Tools are dynamically loaded from your Gateway — the list above is a subset.
