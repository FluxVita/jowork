---
name: jowork-sync
version: 0.1.0
description: |
  Sync data from all connected sources. Run from within your agent to pull
  latest messages, PRs, issues, and metrics into JoWork's local database.
allowed-tools:
  - Bash
---

# /jowork-sync — Sync Data Sources

Trigger a sync of all connected data sources.

```bash
jowork sync 2>&1
```

After sync completes, report:
- Which sources synced
- How many new objects
- Any errors or warnings

Suggest: "Data is fresh. Try `search_data` to query across all sources."
