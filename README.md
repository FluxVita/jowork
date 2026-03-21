# JoWork

**Let AI agents truly understand your work.**

Connect your data sources, give agents awareness and goals. Local-first, one command.

```bash
npm install -g jowork
jowork init
jowork register claude-code
```

That's it. Claude Code now has cross-session memory. No server, no cloud, no config.

---

## What is JoWork?

JoWork is **Agent Infrastructure** — the middleware that turns AI agents from chat tools into autonomous assistants.

Without JoWork, your agent is a genius locked in a dark room. It can think, but it can't see your work.

With JoWork, your agent gets:
- **Eyes** — data connectors that see Feishu, GitHub, PostHog, GitLab, Linear
- **Memory** — cross-session persistence that survives restarts
- **Purpose** — Goal-Signal-Measure system that drives proactive behavior
- **Voice** — channel push that lets the agent reach out when something matters

## Quick Start (30 seconds)

```bash
# Install
npm install -g jowork

# Initialize local database
jowork init

# Register with your AI agent
jowork register claude-code    # or: codex, openclaw

# Connect a data source
jowork connect feishu          # interactive auth
jowork connect github          # uses GITHUB_PERSONAL_ACCESS_TOKEN from env

# Sync data
jowork sync

# Search across all sources
jowork search "product launch"
```

## How It Works

```
Your AI Agent (Claude Code, Codex, OpenClaw, ...)
        │
        │  MCP Protocol (stdio)
        ▼
┌─────────────────────────────────────────┐
│  JoWork CLI                              │
│                                          │
│  MCP Server ──── Goal System             │
│  15 tools        Goal → Signal → Measure │
│  4 resources                             │
│       │                                  │
│  Multi-layer Memory                      │
│  L1 Hot (24-72h) ← Compaction            │
│  L2 Warm (weekly) ← per-Goal             │
│  L3 Cold (all data) ← Sync              │
│       │                                  │
│  Data Connectors                         │
│  Feishu │ GitHub │ GitLab │ PostHog │ ...│
│       │                                  │
│  Cross-source Linker                     │
│  PR refs │ URLs │ @mentions │ temporal   │
└─────────────────────────────────────────┘
        │
        ▼
   Local SQLite (WAL mode, FTS5)
```

## Features

### Data Sources
| Source | What syncs | Status |
|--------|-----------|--------|
| Feishu | Messages, calendar events, wiki docs | Ready |
| GitHub | Repos, issues, pull requests | Ready |
| GitLab | Projects, issues, merge requests | Ready |
| Linear | Issues (GraphQL) | Ready |
| PostHog | Insights, event definitions, metrics | Ready |

### MCP Tools (15)
Your agent can call these automatically:

| Tool | What it does |
|------|-------------|
| `search_data` | Full-text search across all synced data |
| `read_memory` | Recall cross-session memories |
| `write_memory` | Save decisions, preferences, progress |
| `search_memory` | Time-weighted memory search |
| `get_goals` | List active goals with progress |
| `get_metrics` | Signal values and measure status |
| `get_hot_context` | Recent activity summary (24-72h) |
| `get_briefing` | Daily briefing: activity + goals + freshness |
| `push_to_channel` | Send messages to Feishu/Slack/Telegram |
| `update_goal` | Modify goals (copilot mode: needs approval) |

### Goal-Signal-Measure (AI-native, not OKR)
```bash
jowork goal add "Ship v1 by June, DAU 10K"
jowork signal add <goal_id> --source posthog --metric dau --direction maximize
jowork measure add <signal_id> --threshold 10000 --type gte
```

Your agent monitors these automatically. When a measure is met or regresses, it tells you.

### Daemon Mode
```bash
jowork serve --daemon    # Background: syncs every 15 min, polls signals, fires triggers
jowork install-service   # Generate macOS LaunchAgent or Linux systemd unit
```

## CLI Reference

```
jowork init                    # Create local database
jowork serve                   # Start MCP server (stdio, for agents)
jowork serve --daemon          # Background daemon with cron sync
jowork register <engine>       # claude-code | codex | openclaw
jowork connect <source>        # feishu | github | gitlab | linear | posthog
jowork sync [--source <s>]     # Sync data from connected sources
jowork search <query>          # Full-text search
jowork status                  # System overview
jowork doctor                  # Diagnostic checks
jowork export [--format json]  # Backup database
jowork gc [--retention-days N] # Cleanup + vacuum
jowork goal add|list|status    # Goal management
jowork signal add              # Add signal to goal
jowork measure add             # Add measure to signal
jowork device-sync export|import  # Sync between devices
jowork install-service         # Generate system service
```

## Why JoWork?

| Capability | JoWork | claude-mem | Supermemory | Dust.tt |
|-----------|--------|-----------|-------------|---------|
| Local-first | Yes | Yes | No (cloud) | No (cloud) |
| Multi-source sync | Yes | No | Partial | Yes |
| Goal-Signal-Measure | Yes | No | No | No |
| Cross-source linking | Yes | No | No | No |
| Proactive push | Yes | No | No | Partial |
| CLI-first + MCP | Yes | Yes | No | No (Web) |
| Free & open source | AGPL | AGPL | MIT | No |

## Data Privacy

All data stays on your machine. JoWork uses local SQLite with WAL mode. No cloud, no telemetry, no third-party services (except the APIs you explicitly connect).

## Requirements

- Node.js >= 20
- macOS or Linux (Windows: community contributions welcome)

## License

[AGPL-3.0](LICENSE)

## Links

- Website: [jowork.work](https://jowork.work)
- Issues: [GitHub Issues](https://github.com/FluxVita/jowork/issues)
