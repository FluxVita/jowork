---
name: jowork-dashboard
version: 0.1.0
description: |
  Open the JoWork companion dashboard in your browser. Shows data source status,
  active agent sessions, context management, and goal progress.
allowed-tools:
  - Bash
---

# /jowork-dashboard — Open Companion Panel

Launch the JoWork Dashboard in your default browser.

```bash
# Check if dashboard is already running
RUNNING_PORT=$(cat ~/.jowork/dashboard.port 2>/dev/null)
if [ -n "$RUNNING_PORT" ] && curl -s --max-time 1 "http://127.0.0.1:$RUNNING_PORT/api/status" >/dev/null 2>&1; then
  echo "Dashboard already running on port $RUNNING_PORT"
  open "http://127.0.0.1:$RUNNING_PORT"
else
  jowork dashboard &
fi
```

Tell user: "Dashboard is open at http://127.0.0.1:{port}. You can:
- See data source status in the sidebar
- Switch to Sessions tab to see active agent conversations
- Drag folders into Context tab to index files
- Check Goals tab for progress tracking"
