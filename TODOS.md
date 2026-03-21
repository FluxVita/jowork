# TODOS

All items resolved. No outstanding work.

## Completed

### ~~Storage strategy~~ ✅
Resolved in commit `69da413`. Added `jowork gc` command (retention-based cleanup + VACUUM), config `maxDbSizeMB` + `retentionDays`, `jowork status` shows DB size warning at 80%+ capacity.

### ~~Signal Poller + Trigger Engine~~ ✅
Resolved in commit `d54435a`. Implemented `signal-poller.ts` (polls GitHub/Feishu/GitLab/Linear metrics), `trigger-engine.ts` (detects measure state changes + signal regression + stale signals), integrated into daemon cron cycle.

### ~~MCP server DB dependency injection~~ ✅
Resolved in commit `69da413`. `createJoWorkMcpServer` now accepts optional `sqlite` instance via `opts.sqlite`, falls back to creating own connection. Only closes if it owns the connection.
