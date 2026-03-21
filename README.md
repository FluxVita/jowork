# JoWork

**The missing GUI for AI coding agents.** 让 AI Agent 用户更好地创造。

CLI agents like Claude Code, Codex, and OpenClaw are powerful — but managing multiple conversations, dragging files into context, and monitoring data sources? That's painful in a raw terminal.

JoWork fixes this. It's a **companion panel** that sits beside your terminal — not replacing it, but filling the gaps terminals can't.

```
┌─ Your Terminal ──────────┐ ┌─ JoWork Dashboard ──────────────┐
│                          │ │ DATA SOURCES                     │
│  $ claude                │ │ ● feishu  583 msgs  synced 2m    │
│  > What did the team     │ │ ● github  30 PRs    synced 5m    │
│    discuss this week?    │ │                                   │
│                          │ │ Sessions  Context  Goals          │
│  Agent: Based on your    │ │ ┌─────────────────────────────┐  │
│  Feishu messages, 3 main │ │ │ 📁 ~/project/src            │  │
│  topics: ...             │ │ │ 📊 Feishu: Product Chat     │  │
│                          │ │ │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │  │
│                          │ │ │ │ Drop folder to index    │ │  │
│                          │ │ │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │  │
└──────────────────────────┘ └─────────────────────────────────┘
```

## Why JoWork?

**The problem:** Vibe coders and non-technical users are building with AI agents every day. But the terminal UX has real gaps:

| What you want | What the terminal gives you |
|---|---|
| Switch between multiple agent conversations like browser tabs | `tmux` (you need to learn it first) |
| Drag a folder into your conversation for context | Copy-paste file paths manually |
| See which data sources are connected and syncing | Run `jowork status` every time |
| Load specific files + Feishu messages into one conversation | Type MCP tool calls manually |

**JoWork = the companion panel that fills these gaps.** It doesn't replace your terminal — it enhances it.

> JoWork 的价值不只是数据层，而是帮助 Claude Code / Codex / OpenClaw 的用户更好地创造。不在终端产品做得好的地方重复造轮子，只补终端做不好的事。

---

## Quick Start

```bash
# Install
npm install -g jowork

# Initialize + register with your agent
jowork init
jowork register claude-code    # or: codex, openclaw

# Done. Claude Code now has cross-session memory.

# Connect a data source (optional)
jowork connect feishu          # interactive auth
jowork connect github          # uses GITHUB_PERSONAL_ACCESS_TOKEN from env

# Sync + search
jowork sync
jowork search "product launch"

# Open the companion dashboard
jowork dashboard
```

---

## Concrete Scenarios

### 1. "I want to see all my agent sessions in one place"

You have Claude Code running in one terminal tab doing a frontend refactor, Codex in another analyzing data, and OpenClaw working on the API. Today, switching between them means alt-tabbing through terminal windows hoping you find the right one.

**With JoWork Dashboard:**
- Open `jowork dashboard` in your browser
- See all active agent sessions with project name, engine type, and duration
- Click "cd" to copy the command to jump to any session
- Sessions appear and disappear in real-time as agents connect/disconnect

### 2. "I want to drag a folder into my conversation"

You're working with Claude Code and need it to understand your `src/components/` directory. Today, you'd have to describe the files manually or paste paths one by one.

**With JoWork Dashboard:**
- Open the Context tab
- Drag `~/project/src/components/` into the drop zone
- JoWork indexes all files instantly (skips `node_modules`, `.git`, binaries)
- Your agent can now `search_data` and find any file in that folder
- The folder appears in your agent's environment context automatically

### 3. "Show me which data sources are healthy"

You connected Feishu, GitHub, and PostHog. Are they syncing? When was the last sync? How much data is indexed?

**With JoWork Dashboard:**
- Sidebar always shows connection status: 🟢 connected / 🔴 disconnected
- Object counts (583 messages, 30 PRs) at a glance
- Last sync time ("2m ago", "5m ago")
- One-click "Sync Now" button

### 4. "I want my agent to know my goals"

Set goals like "Ship v1 by June, DAU 10K" and JoWork monitors them automatically — tracking signals from PostHog, GitHub milestones, and more.

```bash
jowork goal add "Ship v1 by June, DAU 10K"
jowork signal add <goal_id> --source posthog --metric dau --direction maximize
jowork measure add <signal_id> --threshold 10000 --type gte
```

The Goals tab shows progress bars, signal values, and met/unmet measures. Your agent sees these goals too and can proactively alert you when something changes.

---

## Features

### Companion Dashboard (`jowork dashboard`)

A localhost web UI that runs beside your terminal:

- **Sidebar:** Data source status with live green/red dots, object counts, sync times
- **Sessions tab:** Active agent sessions with engine type, PID, duration, copy-cd button
- **Context tab:** Active context entries + drag-and-drop file indexing
- **Goals tab:** Goal progress with signal values and measure status
- **Real-time:** WebSocket updates, no manual refresh needed
- **Dark/Light mode:** Industrial-minimal design with amber accent
- **Responsive:** Sidebar collapses at narrow widths (works as a half-screen companion)
- **Secure:** CSRF token protection, localhost-only binding

### Data Sources

| Source | What syncs | Status |
|--------|-----------|--------|
| Feishu (飞书) | Messages, calendar events, wiki docs, approvals | Ready |
| GitHub | Repos, issues, pull requests | Ready |
| GitLab | Projects, issues, merge requests | Ready |
| Linear | Issues (GraphQL) | Ready |
| PostHog | Insights, event definitions, metrics | Ready |

### MCP Tools (15)

Your agent calls these automatically via [MCP protocol](https://modelcontextprotocol.io/):

| Tool | What it does |
|------|-------------|
| `search_data` | Full-text search across all synced data (FTS5 + LIKE fallback) |
| `read_memory` / `write_memory` | Cross-session memory with auto-truncation |
| `search_memory` | Time-weighted memory search with recency boost |
| `get_goals` / `get_metrics` | Goal progress and signal values |
| `get_hot_context` | Recent activity summary (last 24-72h) |
| `get_briefing` | Daily briefing: activity + goals + data freshness |
| `push_to_channel` | Send messages to Feishu (Slack/Telegram planned) |
| `update_goal` | Modify goals (copilot mode requires human approval) |
| `get_environment` | System info + active context entries |

### Cross-Source Linking

JoWork automatically connects related data across sources — zero LLM cost:

- `PR#123` in a Feishu message → linked to the GitHub PR
- `LIN-456` → linked to the Linear issue
- `@mention` → linked to the person
- Temporal linking: objects from different sources created within 2 hours

### Multi-Layer Memory

| Layer | Content | Access |
|-------|---------|--------|
| L1 Hot | Last 24-72h summary | `get_hot_context()` |
| L2 Warm | Per-goal weekly trends | `get_briefing()` |
| L3 Cold | All raw data | `search_data()` |

Your agent gets L1-L2 summaries by default (saves tokens). When it needs to dig deeper, it queries L3.

---

## How It Works

```
Your AI Agent (Claude Code, Codex, OpenClaw)
        │
        │  MCP Protocol (stdio)
        ▼
┌───────────────────────────────────────────────────┐
│  JoWork CLI                                        │
│                                                    │
│  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ MCP Server   │  │ Goal System               │  │
│  │ 15 tools     │  │ Goal → Signal → Measure   │  │
│  │ 4 resources  │  │                           │  │
│  └──────┬───────┘  └───────────┬───────────────┘  │
│         │                      │                   │
│  ┌──────▼──────────────────────▼───────────────┐  │
│  │ Multi-layer Memory + Cross-source Linker    │  │
│  │ L1 Hot ← Compaction ← L3 Cold ← Sync      │  │
│  └──────────────────────┬──────────────────────┘  │
│                         │                          │
│  ┌──────────────────────▼──────────────────────┐  │
│  │ Data Connectors                              │  │
│  │ Feishu │ GitHub │ GitLab │ Linear │ PostHog  │  │
│  └─────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────┘
        │
        ▼
   Local SQLite (WAL mode, FTS5, all data on your machine)
```

The Dashboard is a separate process that shares the same SQLite database:

```
Browser (localhost:18801)  ←→  Dashboard Server (Hono + WebSocket)
                                      │
                                  SQLite DB  ←  Daemon (cron sync every 15 min)
                                      │
                                  MCP Server  ←  Your Agent
```

---

## CLI Reference

```bash
# Setup
jowork init                        # Create local database
jowork register <engine>           # claude-code | codex | openclaw
jowork connect <source>            # feishu | github | gitlab | linear | posthog
jowork doctor                      # Diagnostic checks

# Daily use
jowork dashboard                   # Open companion panel in browser
jowork sync [--source <s>]         # Sync data from connected sources
jowork search <query>              # Full-text search across all data
jowork status                      # System overview
jowork serve --daemon              # Background daemon (sync + signals + triggers)

# Goals
jowork goal add|list|status        # Goal management
jowork signal add <goal_id>        # Add signal to goal
jowork measure add <signal_id>     # Add measure to signal

# Maintenance
jowork export [--format json]      # Backup database
jowork gc [--retention-days N]     # Cleanup old data + vacuum
jowork device-sync export|import   # Sync between devices
jowork install-service             # Generate LaunchAgent / systemd unit
```

---

## Comparison

| Capability | JoWork | claude-mem | Supermemory | Dust.tt |
|-----------|--------|-----------|-------------|---------|
| Local-first | ✅ | ✅ | ❌ cloud | ❌ cloud |
| Companion Dashboard | ✅ | ❌ | ❌ | ❌ |
| Multi-source sync | ✅ | ❌ | Partial | ✅ |
| Goal-Signal-Measure | ✅ | ❌ | ❌ | ❌ |
| Cross-source linking | ✅ | ❌ | ❌ | ❌ |
| Proactive push | ✅ | ❌ | ❌ | Partial |
| CLI-first + MCP | ✅ | ✅ | ❌ | ❌ Web |
| Free & open source | AGPL | AGPL | MIT | ❌ |

---

## Data Privacy

All data stays on your machine. JoWork uses local SQLite with WAL mode. No cloud, no telemetry, no third-party services — except the APIs you explicitly connect.

## Requirements

- Node.js >= 20
- macOS or Linux (Windows: community contributions welcome)

## Roadmap

- [ ] Native terminal window focus (AppleScript / wmctrl)
- [ ] Tauri desktop app wrapper for system-level integration
- [ ] More data sources: Slack, Notion, Jira, Firebase
- [ ] Team collaboration (shared goals, multi-user sync)
- [ ] Cloud sync for multi-device setups

## License

[AGPL-3.0](LICENSE) — free for personal use. Commercial embedding requires a license.

## Links

- Website: [jowork.work](https://jowork.work)
- Issues: [GitHub Issues](https://github.com/FluxVita/jowork/issues)
