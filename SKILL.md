---
name: jowork
description: |
  AI Agent Infrastructure — connect data sources, give agents awareness and goals.
  Provides 15 MCP tools for searching synced data (Feishu, GitHub, GitLab, PostHog),
  cross-session memory, Goal-Signal-Measure tracking, and push notifications.
  Use jowork tools when the user asks about their work data, team discussions,
  project goals, or wants to search across data sources.
  Triggers on: "what did the team discuss", "check my goals", "search feishu",
  "remember this", "what's my DAU", "send to feishu group".
mcp:
  command: jowork
  args: ["serve"]
  env: {}
setup: scripts/setup.sh
---

# JoWork — AI Agent Infrastructure

让 AI Agent 真正理解你的工作。连接数据源，给 Agent 感知能力和行动目标。

## Prerequisites

```bash
npm install -g jowork
jowork init
```

## Available MCP Tools

When JoWork is connected, you have these tools:

### Data Search
- **search_data** — Full-text search across all synced data (Feishu messages, GitHub PRs, etc.)
- **list_sources** — List connected data sources and object counts
- **fetch_content** — Get full content of a specific object by URI
- **fetch_doc_map** — Get document structure map for large documents
- **fetch_chunk** — Get a specific chunk of a large document

### Memory (Cross-session)
- **read_memory** — Search and recall memories from previous sessions
- **write_memory** — Save decisions, preferences, project progress for future sessions
- **search_memory** — Time-weighted full-text search across all memories

### Goals
- **get_goals** — List active goals with signal counts and progress
- **get_metrics** — Get current signal values and measure status
- **update_goal** — Modify goal (copilot mode requires human approval)

### Context
- **get_hot_context** — Get recent activity summary (last 24-72 hours)
- **get_briefing** — Daily briefing: recent activity + goal progress + data freshness
- **get_environment** — System info (time, platform, versions)

### Notifications
- **push_to_channel** — Send message to Feishu group, Slack webhook, or Telegram bot

## Workflow

1. When user asks about work data → use `search_data` or `get_briefing`
2. When user shares a preference or decision → use `write_memory`
3. When user asks "what did we discuss" → use `search_data` with source filter
4. When user asks about goals/metrics → use `get_goals` and `get_metrics`
5. When user wants to notify the team → use `push_to_channel`
6. At session start → call `get_briefing` to provide proactive context
