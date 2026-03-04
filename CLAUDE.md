# CLAUDE.md — Jowork Project Instructions

> This is the open-source Jowork repository. Read `docs/JOWORK-PLAN.md` as your primary spec.
> Read `AGENTS.md` for multi-AI collaboration rules before doing anything.

## What is Jowork?

An open-source, self-hosted AI coworker platform. Think "VS Code for AI teammates" — users install it like an app, connect their tools, and get a 24/7 AI coworker that knows their business.

## Tech Stack (LOCKED — do not deviate)

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 22+ |
| Language | TypeScript (strict mode) |
| Server | Express 5 + better-sqlite3 |
| Desktop | Tauri 2 (Rust) |
| Gateway binary | Bun `--compile` (single-file sidecar) |
| Frontend | Vue 3 via CDN (no build step) |
| Database | SQLite with FTS5 |
| Package manager | pnpm workspaces |
| License | AGPL-3.0 (core) |

## Monorepo Structure (target)

```
jowork/
  packages/
    core/          # @jowork/core — AGPL-3.0, gateway + agent engine
    premium/       # @jowork/premium — commercial license
  apps/
    jowork/        # Open-source Tauri desktop app
  docs/            # Documentation
  scripts/         # Dev tooling
```

## Commands

```bash
pnpm install          # Install all dependencies
pnpm --filter @jowork/core build   # Build core
pnpm --filter @jowork/core test    # Run tests
pnpm --filter @jowork/core lint    # Lint
```

## Key Conventions

- **Express 5 wildcard**: `/{*path}` (NOT `*`)
- **Path aliases**: `@/*` → `src/*`
- **Config**: manual `.env` parse, no dotenv dependency
- **DB migrations**: `CREATE TABLE IF NOT EXISTS` in `db.ts`
- **New API routes**: one file per domain in `src/routes/`
- **Edition gating**: `src/edition.ts` → `EditionFeatures` interface
- **Personal mode**: no login required, data in OS standard paths

## Current Phase

See `docs/JOWORK-PLAN.md` Section 0.7 (phase status table) for current progress.
Always start by reading that table and continuing from where the last AI left off.

## Commit Convention

```
feat(scope): description     # new feature
fix(scope): description      # bug fix
chore(scope): description    # tooling/config
test(scope): description     # tests
docs(scope): description     # documentation
```

## IMPORTANT: After each task

Update Section 0.7 of `docs/JOWORK-PLAN.md` to reflect new status.
