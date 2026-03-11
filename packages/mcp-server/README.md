# @jowork/mcp-server

Expose your [JoWork](https://jowork.work) Gateway tools to any MCP client — Claude Desktop, Cursor, Cline, OpenClaw, and more.

Search Feishu docs, create GitLab MRs, query PostHog data, send Lark messages — all from your AI assistant of choice.

## Quick Start

```bash
npm install -g @jowork/mcp-server
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jowork": {
      "command": "jowork-mcp",
      "env": {
        "JOWORK_URL": "https://jowork.work",
        "JOWORK_TOKEN": "<your-jwt-token>"
      }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "jowork": {
      "command": "jowork-mcp",
      "env": {
        "JOWORK_URL": "https://jowork.work",
        "JOWORK_TOKEN": "<your-jwt-token>"
      }
    }
  }
}
```

### Claude Code

Add to `.mcp.json`:

```json
{
  "mcpServers": {
    "jowork": {
      "command": "jowork-mcp",
      "env": {
        "JOWORK_URL": "https://jowork.work",
        "JOWORK_TOKEN": "<your-jwt-token>"
      }
    }
  }
}
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `JOWORK_URL` | Yes | Gateway URL (e.g. `https://jowork.work` or `http://localhost:18800`) |
| `JOWORK_TOKEN` | Option 1 | JWT token for authentication |
| `JOWORK_USERNAME` | Option 2 | Username for local auth (`/api/auth/local`) |
| `JOWORK_PASSWORD` | Option 2 | Password (optional if local auth doesn't require it) |

Either `JOWORK_TOKEN` or `JOWORK_USERNAME` is required.

## Getting a Token

1. Log in to your JoWork Gateway web UI
2. Open browser DevTools → Application → Local Storage
3. Copy the `jowork_token` value

Or via API:

```bash
curl -s -X POST https://jowork.work/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","display_name":"Admin"}' \
  | jq -r .token
```

## Available Tools

Tools are dynamically loaded from your Gateway. Common tools include:

- **jowork_search_data** — Full-text search across Feishu docs, GitLab code, Linear issues
- **jowork_fetch_content** — Fetch full content of any indexed document
- **jowork_list_sources** — List connected data sources
- **jowork_run_query** — Structured query against data index
- **jowork_query_posthog** — Query PostHog user behavior data
- **jowork_create_gitlab_mr** — Create GitLab merge requests
- **jowork_lark_send_message** — Send Feishu/Lark messages
- **jowork_lark_list_chats** — List Feishu group chats
- **jowork_lark_create_calendar_event** — Create calendar events
- **jowork_read_memory** / **jowork_write_memory** — Agent memory

## Resources

- `jowork://health` — Gateway health status
- `jowork://sources` — Connected data source list

## Troubleshooting

**"JOWORK_URL is required"**
Set the `JOWORK_URL` environment variable to your Gateway URL.

**"Auth failed (401)"**
Your JWT token has expired (default: 7 days). Get a new one from the web UI or API.

**Tools list is empty**
The Gateway may be unreachable. Check that `JOWORK_URL` is correct and the Gateway is running.

**Permission denied on tool call**
Your user role doesn't have access to that tool. Contact your Gateway admin to grant permissions.

## License

MIT
