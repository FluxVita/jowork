# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm install                    # Install all dependencies
pnpm build                      # Full build (all packages)
pnpm lint                       # tsc --noEmit across all packages
pnpm test                       # Vitest across all packages

# CLI (primary product, run from apps/cli/)
pnpm --filter jowork lint
pnpm --filter jowork test
pnpm --filter jowork build       # tsup build → dist/cli.js + dist/transport.js
cd apps/cli && node dist/cli.js  # Run locally after build

# Core package (run from packages/core/)
pnpm --filter @jowork/core test
pnpm --filter @jowork/core lint

# Desktop (legacy, pending removal)
pnpm --filter @jowork/desktop dev
pnpm --filter @jowork/desktop lint
```

Native modules (`better-sqlite3`) require rebuild for current Node.js version: `pnpm rebuild better-sqlite3`.

## Architecture

**Monorepo** (pnpm workspaces + Turborepo):

```
packages/core/     → Shared types, DB schema (Drizzle), i18n, ID generation (nanoid)
apps/cli/          → CLI tool (primary product, npm install -g jowork)
apps/desktop/      → Electron app (legacy, pending removal)
apps/cloud/        → Hono backend (legacy, pending removal)
```

### CLI Architecture (apps/cli/)

```
apps/cli/src/
├── cli.ts              → Commander.js entry point
├── commands/           → CLI subcommands (init, serve, register, connect, sync, ...)
├── db/manager.ts       → DbManager: SQLite + WAL + migrations + Drizzle ORM
├── mcp/
│   ├── server.ts       → MCP server with tools + resources
│   └── transport.ts    → stdio transport entry (spawned by Agent engines)
├── memory/store.ts     → MemoryStore: CRUD + FTS search
├── connectors/
│   └── credential-store.ts → File-based credential storage (chmod 600)
├── context/assembler.ts    → Context assembly for agent prompts
├── sync/linker.ts      → Cross-source entity extraction (regex, zero LLM cost)
└── utils/              → Logger (pino), paths, config
```

### MCP Tools

Data: search_data, list_sources, fetch_content, fetch_doc_map, fetch_chunk
Memory: read_memory, write_memory, search_memory
System: get_environment

### MCP Resources

jowork://connectors, jowork://memories, jowork://status

### Data Flow

```
jowork connect feishu → credential stored → jowork sync
  → Feishu API (paginated, batch 100/txn) → objects + object_bodies
  → Regex linker → object_links
  → FTS5 rebuild
  → Agent queries via MCP tools (search_data, read_memory, etc.)
```

### Electron Process Boundaries (legacy)

```
Main Process (Node.js)
├── index.ts              → Window creation, menu, setupIPC()
├── ipc.ts                → 78 IPC handlers (engine, chat, session, connector, memory, ...)
├── engine/
│   ├── manager.ts        → EngineManager: dispatches to active engine adapter
│   ├── claude-code.ts    → Spawns `claude` CLI with -p --output-format stream-json --verbose
│   ├── cloud.ts          → SSE client to cloud API (requires auth)
│   └── history.ts        → HistoryManager: SQLite persistence for sessions/messages
├── connectors/hub.ts     → ConnectorHub: MCP stdio clients for GitHub/GitLab/Figma/Feishu/local
├── mcp/
│   ├── server.ts         → JoWork's own MCP server (search_data, read_memory, etc.)
│   ├── inject.ts         → Registers MCP servers into ~/.claude.json via ToolsRegistry
│   └── tools-registry.ts → In-memory registry, syncs to all engine configs
├── memory/store.ts       → Memory CRUD + FTS search
├── context/assembler.ts  → Builds system prompt (workstyle + memories + docs, 4K token budget)
├── scheduler/index.ts    → Cron executor (croner)
├── auth/manager.ts       → Google OAuth + JWT
└── sync/sync-manager.ts  → Cloud sync for Team mode

Preload (preload/index.ts)
└── Exposes typed `window.jowork` API with channel allowlist (contextIsolation: true)

Renderer (React 19 + TypeScript)
├── App.tsx               → HashRouter routes (file:// needs hash routing)
├── stores/conversation.ts → Zustand store (sessions, messages, streaming state)
├── features/             → Feature modules (conversation, connectors, memory, skills, ...)
└── styles/globals.css    → Design tokens, animations
```

### Chat Data Flow

```
InputBox → window.jowork.chat.send() → IPC
  → EngineManager.chat() → assembleContext() → spawn claude CLI
  → JSONL stream → parse EngineEvent → safeSend('chat:event', ...)
  → Renderer listens on 'chat:event' → updates Zustand store
```

Key details:
- Claude Code CLI is spawned with `stdio: ['ignore', 'pipe', 'pipe']` — stdin must be `ignore`
- Session resume uses `--resume <engineSessionId>` from `engine_session_mappings` table
- `safeSend()` guards against sending to destroyed renderer (`event.sender.isDestroyed()`)

### MCP Two-Layer Design

1. **JoWork MCP Server** — Exposes app data to Claude Code (search_data, fetch_content, read_memory, write_memory, send_message, notify)
2. **Connector MCP Clients** — ConnectorHub manages external MCP servers (GitHub, GitLab, Figma, Feishu, local filesystem)

The MCP server entry (`mcp-server-entry.ts`) has a stdout guard banner that redirects non-JSON output to stderr before any `require()` — this prevents i18next and other libraries from polluting the MCP JSON protocol.

### Database

SQLite via better-sqlite3 + Drizzle ORM. Schema in `packages/core/src/db/schema.ts`. Tables created by `HistoryManager.ensureTables()`:

Core: `sessions`, `messages`, `engine_session_mappings`, `settings`, `connector_configs`, `objects`, `object_bodies`, `sync_cursors`
FTS5: `objects_fts`, `messages_fts` (contentless, content-table mode)
Other modules create: `memories`, `context_docs`, `scheduled_tasks`, `task_executions`, `sync_queue`

WAL mode enabled. IDs use prefixed nanoid: `createId('ses')`, `createId('msg')`, etc.

### Styling

Tailwind CSS v3.4 with custom design tokens in `tailwind.config.ts`:
- Solid colors (`surface-0`, `background`, `primary`, `accent`) use `solid()` function supporting `/opacity` modifier
- Transparent colors (`surface-1`, `surface-2`, `border`, `text-secondary`) are plain strings — no opacity modifier support
- shadcn/ui components via Radix primitives + `class-variance-authority` + `tailwind-merge`
- Custom opacity values: 35, 92

### Error Logging

Path: `~/Library/Application Support/@jowork/desktop/logs/errors.jsonl`
Format: JSONL with `{ ts, level, category, msg, ctx, stack }`, category: `chat | engine | render | ipc | process`

## Known Constraints

- `ws` pinned to 8.18.3 (8.19.0 has ESM wrapper.mjs bug)
- Electron `sandbox: false` on preload (needs Node API for IPC bridge)
- HashRouter required — `file://` doesn't support HTML5 history API
- pnpm must use copy mode (`pnpm config set package-import-method copy`) to avoid macOS hard-link mmap deadlock
- MCP server stdout must be pure JSON — any `console.log` in dependencies breaks the protocol

## Project References

- **Plan overview**: `PLAN.md`
- **Phase details**: `plans/phase-X-*.md`
- **Old codebase** (reference only): `/Users/signalz/Documents/augment-projects/jowork-v1-archived`
- **Domain**: jowork.work (not jowork.dev)
