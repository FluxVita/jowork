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
```

> Desktop and cloud code removed in v3 pivot. Reference: `git tag v2-desktop-archive`

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

### Database

SQLite via better-sqlite3 + Drizzle ORM. Schema in `packages/core/src/db/schema.ts`.
Tables managed by `DbManager` with migration system (schema_version tracking):

Core: `settings`, `connector_configs`, `objects`, `object_bodies`, `object_chunks`, `sync_cursors`, `memories`, `object_links`
FTS5: `objects_fts`, `memories_fts`

WAL mode + busy_timeout 5000ms. IDs use prefixed nanoid: `createId('obj')`, `createId('mem')`, etc.

### Error Logging

Path: `~/.jowork/logs/jowork.log`
Daemon log: `~/.jowork/logs/daemon.log` (JSONL)

## Known Constraints

- pnpm must use copy mode (`pnpm config set package-import-method copy`) to avoid macOS hard-link mmap deadlock
- MCP server stdout must be pure JSON — i18next banner suppressed via `showSupportNotice: false`
- better-sqlite3 requires native rebuild per Node.js version: `pnpm rebuild better-sqlite3`
- SQLite batch writes must use short transactions (100/txn) to avoid SQLITE_BUSY with concurrent MCP + daemon

## Project References

- **Plan**: `plan-v3.md`
- **Old codebase**: `git tag v2-desktop-archive`
- **Domain**: jowork.work (not jowork.dev)
