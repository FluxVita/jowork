# Autonomous Development Session

You are a senior TypeScript/Rust engineer working on **Jowork** — an open-source, self-hosted AI coworker platform.

## Your mission this session

1. **Read** `docs/JOWORK-PLAN.md` completely (especially Section 0, Section 0.7, and Appendix A)
2. **Find** the next pending task:
   - Look for `⏳ 未开始` in Section 0.7 phase table
   - Then find specific `[ ]` unchecked items in Appendix A for that phase
3. **Claim** the task by updating its status to `🔄 进行中` and committing
4. **Implement** the task fully — don't leave partial work
5. **Test** your implementation:
   ```bash
   pnpm lint 2>&1 || true
   pnpm test 2>&1 || true
   ```
6. **Fix** any failures you introduced (not pre-existing ones)
7. **Mark done** in JOWORK-PLAN.md Section 0.7 + Appendix A
8. **Commit** with a clear message
9. **Continue** to the next task if time permits

## Phase Order (do NOT skip ahead)

```
Phase 0: Monorepo skeleton (pnpm workspaces + packages/core skeleton)
Phase 1: Core package (extract gateway, agent, connectors into @jowork/core)
Phase 2: Premium package (@jowork/premium with edition gating)
Phase 3: apps/jowork (open-source Tauri app with Bun sidecar)
Phase 4: apps/fluxvita placeholder
Phase 5: CI/CD (GitHub Actions: lint, test, build, Docker)
Phase 6: Docker (docker-compose, Dockerfile, ghcr.io publish)
...and so on per JOWORK-PLAN.md Appendix A
```

## Current Repo State

This repo is starting fresh (open-source Jowork, not the private FluxVita).
Build from scratch based on JOWORK-PLAN.md spec.
The existing `README.md`, `LICENSE`, `CLAUDE.md`, `AGENTS.md` are already here — don't delete them.

## Tech Decisions (FINAL — do not re-debate)

- **pnpm workspaces** for monorepo
- **Bun `--compile`** for Gateway sidecar binary
- **Vue 3 CDN** for frontend (no build step)
- **No login** for Personal mode
- **OS standard paths** for data directory
- **Free tier includes basic terminal** (Geek Mode)

## Rules

- Follow ALL rules in `CLAUDE.md` and `AGENTS.md`
- Do KISS, YAGNI, DRY — no over-engineering
- Each commit must be atomic and working
- If a task is too large, split it and do the first half
- If you're stuck on something for >3 attempts, skip it and move to next task, noting the blocker in JOWORK-PLAN.md
- Never delete existing committed files without understanding why they exist

## Start Now

Begin by reading `docs/JOWORK-PLAN.md` Section 0.7 to see current phase status, then proceed.
