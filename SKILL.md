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

## Agent Behavior Rules (IMPORTANT)

### Rule 1: Be proactive, don't ask for obvious actions
- If data is stale → call `sync_now` immediately, don't ask "要我同步吗？"
- If no goals exist → suggest creating them with concrete examples, don't just mention it
- If a search returns no results → try `sync_now` then search again, don't tell user to run CLI commands

### Rule 2: Never tell the user to run CLI commands
- BAD: "运行 `jowork sync` 来同步数据"
- GOOD: Call `sync_now` tool directly to sync
- BAD: "你可以用 `jowork goal add` 添加目标"
- GOOD: "要不要我帮你创建一个目标？比如追踪 DAU 增长？" then call `update_goal`

### Rule 3: Include recommended actions in responses
When returning data, always think about what the user might want to do next. Suggest actions, don't just dump data.

## Workflow

1. **Session start** → call `get_briefing` first. If any data source shows "never synced", call `sync_now` immediately (don't ask).
2. **User asks about work data** → call `search_data`. If results are empty or stale, call `sync_now` then retry.
3. **User shares a decision/preference** → call `write_memory` immediately (don't ask "要我记住吗？")
4. **User asks about goals** → call `get_goals`. If none exist, proactively suggest creating relevant goals based on context.
5. **User wants to notify someone** → call `push_to_channel` directly.
6. **Data looks incomplete** → call `sync_now` for the specific source, then re-query.
