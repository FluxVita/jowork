<p align="center">
  <h1 align="center">JoWork</h1>
  <p align="center"><strong>The missing GUI for AI coding agents.</strong></p>
  <p align="center">
    Manage multiple agent sessions, drag files into context, monitor data sources — all from a companion panel beside your terminal.
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/jowork"><img src="https://img.shields.io/npm/v/jowork?style=flat-square&color=E8B931" alt="npm version"></a>
    <a href="https://github.com/FluxVita/jowork/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License"></a>
    <a href="https://jowork.work"><img src="https://img.shields.io/badge/docs-jowork.work-black?style=flat-square" alt="Docs"></a>
  </p>
  <p align="center">
    <a href="./README.zh-CN.md">中文文档</a>
    <span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
    <a href="https://jowork.work">Website</a>
    <span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
    <a href="https://github.com/FluxVita/jowork/issues">Issues</a>
  </p>
</p>

<br>

```
┌─ Your Terminal ──────────┐  ┌─ JoWork Dashboard ──────────────┐
│                          │  │ DATA SOURCES                     │
│  $ claude                │  │ ● slack    1.2K msgs  synced 2m  │
│  > What did the team     │  │ ● github   89 PRs     synced 5m  │
│    discuss this week?    │  │                                   │
│                          │  │ Sessions  Context  Goals          │
│  Agent: Based on your    │  │ ┌─────────────────────────────┐  │
│  Slack messages, 3 main  │  │ │ 📁 ~/project/src            │  │
│  topics: ...             │  │ │ 📊 Slack: #engineering      │  │
│                          │  │ │                             │  │
│                          │  │ │  [ Drop folder to index ]   │  │
│                          │  │ └─────────────────────────────┘  │
└──────────────────────────┘  └─────────────────────────────────┘
```

<br>

## The Problem

Vibe coders and non-technical users build with AI agents every day. But the terminal UX has real gaps:

| What you want | What the terminal gives you |
|---|---|
| Switch between agent conversations like browser tabs | `tmux` — good luck learning it |
| Drag a folder into your conversation for context | Copy-paste file paths one by one |
| See which data sources are connected and syncing | Run a status command every time |
| Load specific files + Slack channel into one conversation | Type MCP tool calls manually |

**JoWork is the companion panel that fills these gaps.** No chat engine, no terminal emulator — only the things terminals can't do.

<br>

## Quick Start

```bash
npm install -g jowork
jowork init && jowork register claude-code
```

That's it. Your agent now has cross-session memory. No server, no cloud.

```bash
# Connect data sources
jowork connect github          # uses GITHUB_PERSONAL_ACCESS_TOKEN
jowork connect slack           # interactive OAuth

# Sync and search
jowork sync
jowork search "deployment plan"

# Open the companion dashboard
jowork dashboard
```

> [!TIP]
> Also works with Codex and OpenClaw: `jowork register codex` or `jowork register openclaw`

<br>

## How It Works

### Scenario 1 — "I have 3 agents running. Which one is doing what?"

You have Claude Code refactoring the frontend, Codex analyzing data, and OpenClaw writing the API. Switching between them means alt-tabbing through terminal windows.

**With JoWork:** Open `jowork dashboard` → see all active sessions with project name, engine, and duration → click "Focus" to jump to the right terminal window.

### Scenario 2 — "I need my agent to understand this folder"

You need Claude Code to understand your `src/components/` directory. Today you'd describe files manually.

**With JoWork:** Open Context tab → drag `~/project/src/` into the drop zone → JoWork indexes all files instantly (skips `node_modules`, `.git`, binaries) → your agent can now search and reference every file.

### Scenario 3 — "Are my data sources syncing?"

You connected Slack, GitHub, and Linear. Are they healthy?

**With JoWork:** Sidebar shows live status dots (🟢/🔴), object counts, and last sync times. One-click "Sync Now" when you need fresh data.

### Scenario 4 — "Track my product launch goal"

```bash
jowork goal add "Ship v1 by June, DAU 10K"
jowork signal add <goal_id> --source posthog --metric dau --direction maximize
jowork measure add <signal_id> --threshold 10000 --type gte
```

Goals tab shows progress bars and signal values. Your agent sees these goals and alerts you when metrics change.

<br>

## Data Sync Architecture

JoWork stores your data as **local files** — markdown for messages/docs/issues, JSON for analytics. Like a code repository, managed by git.

```
~/.jowork/data/repo/
├── feishu/messages/资料分享/2026-03-21.md   ← daily chat log
├── github/FluxVita-jowork/issues/42.md     ← issue with YAML frontmatter
├── posthog/insights/DAU-trend.json         ← analytics as JSON
└── .git/                                    ← version-controlled
```

### Sync modes
- **Pull**: `jowork sync` — fetch latest from all sources
- **Push**: `jowork push` — push local edits back to GitHub/GitLab/Linear
- **Auto**: `jowork serve --daemon` — sync every 15 min (configurable per source)

### Bidirectional sync
| Source | Pull | Push | What can be pushed |
|--------|------|------|--------------------|
| GitHub/GitLab | ✅ | ✅ | Issue title, body, state, labels |
| Linear | ✅ | ✅ | Issue title |
| Feishu messages | ✅ | ❌ | Read-only (use push_to_channel) |
| PostHog/Sentry | ✅ | ❌ | Analytics are read-only |

### Configure sync frequency
```bash
jowork config set syncIntervalMinutes 10                    # All sources
jowork config set syncIntervals '{"feishu":5,"github":30}'  # Per-source
```

<br>

## Features

### Companion Dashboard

A localhost web UI that runs beside your terminal (`jowork dashboard`):

- **Sidebar** — data source status with live dots, object counts, sync times
- **Sessions** — active agent sessions with engine type, focus button, duration
- **Context** — drag-and-drop file indexing + active context entries
- **Goals** — goal progress with signal values and measure status
- **Real-time** — WebSocket updates, no manual refresh
- **Dark/Light** — industrial-minimal design, amber accent
- **Responsive** — works at half-screen width beside your terminal
- **Secure** — CSRF protection, localhost-only binding

### Data Sources

| Source | What syncs |
|--------|-----------|
| GitHub | Repos, issues, pull requests |
| GitLab | Projects, issues, merge requests |
| Linear | Issues via GraphQL |
| PostHog | Insights, event definitions, metrics |
| Slack | Channel messages *(planned)* |
| Feishu | Messages, calendar, wiki, approvals |

### MCP Tools

Your agent calls these automatically via [MCP protocol](https://modelcontextprotocol.io/):

- **`search_data`** — full-text search across all synced data
- **`read_memory` / `write_memory`** — cross-session memory with auto-truncation
- **`search_memory`** — time-weighted search with recency boost
- **`get_goals` / `get_metrics`** — goal progress and signal values
- **`get_hot_context`** — recent activity summary (24-72h)
- **`get_briefing`** — daily briefing with activity, goals, and data freshness
- **`push_to_channel`** — send messages to connected channels
- **`get_environment`** — system info + active context entries

### Cross-Source Linking

Automatically connects related data across sources — zero LLM cost:

- `PR#123` in Slack → linked to the GitHub PR
- `LIN-456` → linked to the Linear issue
- `@mention` → linked to the person
- Temporal linking — objects from different sources created within 2 hours

### Multi-Layer Memory

| Layer | Content | When to use |
|-------|---------|-------------|
| L1 Hot | Last 24-72h summary | "What happened today?" |
| L2 Warm | Per-goal weekly trends | "How's the launch going?" |
| L3 Cold | All raw data | "Find that PR discussion from last month" |

Agent gets L1-L2 by default (saves tokens). Digs into L3 when needed.

<br>

## Architecture

```
Your AI Agent (Claude Code / Codex / OpenClaw)
         │
         │ MCP Protocol (stdio)
         ▼
┌─────────────────────────────────────────────────┐
│  JoWork CLI                                      │
│                                                  │
│  MCP Server (15 tools) ─── Goal-Signal-Measure   │
│         │                                        │
│  Multi-layer Memory ─── Cross-source Linker      │
│         │                                        │
│  Data Connectors                                 │
│  GitHub · GitLab · Linear · PostHog · Slack · …  │
└─────────────────────────────────────────────────┘
         │
    Local SQLite (WAL, FTS5)
```

Dashboard shares the same database as a separate process:

```
Browser (:18801)  ↔  Dashboard (Hono + WS)  ↔  SQLite  ↔  Daemon (sync)
                                                  ↕
                                             MCP Server  ↔  Agent
```

<br>

## CLI Reference

<details>
<summary><strong>Full command list</strong></summary>

```bash
# Setup
jowork init                        # Create local database
jowork register <engine>           # claude-code | codex | openclaw
jowork connect <source>            # github | gitlab | linear | posthog | feishu
jowork doctor                      # Diagnostic checks

# Daily use
jowork dashboard                   # Open companion panel in browser
jowork sync [--source <s>]         # Sync from connected sources
jowork search <query>              # Full-text search
jowork status                      # System overview
jowork log                         # Show sync history
jowork push                        # Push local changes back to sources
jowork serve --daemon              # Background sync + signal polling

# Configuration
jowork config get <key>            # Get a config value
jowork config set <key> <value>    # Set a config value
jowork config list                 # Show all configuration

# Goals
jowork goal add|list|status        # Goal management
jowork signal add <goal_id>        # Bind signal to goal
jowork measure add <signal_id>     # Set threshold for signal

# Maintenance
jowork export [--format json]      # Backup database
jowork gc [--retention-days N]     # Cleanup + vacuum
jowork device-sync export|import   # Sync between machines
jowork install-service             # Generate LaunchAgent / systemd
```

</details>

<br>

## Comparison

| | JoWork | claude-mem | Supermemory | Dust.tt |
|---|:---:|:---:|:---:|:---:|
| Local-first | ✅ | ✅ | ❌ | ❌ |
| Companion Dashboard | ✅ | — | — | — |
| Multi-source sync | ✅ | — | Partial | ✅ |
| Goal-Signal-Measure | ✅ | — | — | — |
| Cross-source linking | ✅ | — | — | — |
| Proactive alerts | ✅ | — | — | Partial |
| CLI + MCP | ✅ | ✅ | — | — |
| Open source | AGPL | AGPL | MIT | ❌ |

<br>

## Roadmap

- [ ] Tauri desktop wrapper for system-level drag-and-drop
- [ ] Slack and Notion connectors
- [ ] Team collaboration with shared goals
- [ ] Cloud sync for multi-device setups

## Data Privacy

All data stays on your machine. Local SQLite, no cloud, no telemetry. The only network calls are to APIs you explicitly connect.

## Requirements

Node.js >= 20 · macOS or Linux · Windows contributions welcome

## License

[AGPL-3.0](LICENSE) — free for personal use. Commercial embedding requires a license.
