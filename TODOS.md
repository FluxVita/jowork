# TODOS

## Storage strategy: retention policy + DB size management

**What:** Design and implement data retention policy, DB size monitoring, and SQLite vacuum/reindex plan.

**Why:** "Store everything locally" (plan-v3.md) with no retention or size guardrails means the SQLite DB will grow unbounded as Feishu messages, meeting transcripts, and documents accumulate. At scale (months of data from active groups), this will degrade FTS query performance and consume significant disk space.

**Pros:** Prevents DB bloat before it becomes a user-reported issue. Enables predictable performance characteristics. Gives users control over storage usage.

**Cons:** Adds complexity to the sync pipeline (must handle retention-driven deletes). Risk of accidentally deleting data users want to keep.

**Context:** Phase 1 stores all synced data in `objects` + `object_bodies` tables with no eviction. FTS5 indexes (`objects_fts`) grow proportionally. `jowork export` provides manual backup but no automatic management. This TODO should be addressed before heavy production use — likely Phase 2 timeframe.

Concrete tasks:
- Add `max_db_size` config option with default (e.g., 1GB)
- `jowork status` should show current DB size and warn when approaching limit
- Design retention tiers: keep L1/L2 summaries indefinitely, expire L3 raw bodies after N days (configurable)
- Add periodic `VACUUM` to `jowork serve --daemon` cron schedule
- Add `jowork gc` command for manual cleanup

**Effort:** M (human: ~3 days / CC: ~30 min)
**Priority:** P2 — not blocking Phase 1, but should be resolved before Phase 2 completes
**Depends on:** Phase 1 DB schema + sync pipeline being stable
**Source:** Codex review #16 (2026-03-20)
