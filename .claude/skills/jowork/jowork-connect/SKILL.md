---
name: jowork-connect
version: 0.1.0
description: |
  Connect a data source (GitHub, GitLab, Linear, PostHog, Slack, Feishu) to JoWork
  from within your AI agent. No need to leave the terminal.
allowed-tools:
  - Bash
  - AskUserQuestion
---

# /jowork-connect — Connect Data Source

Connect a data source to JoWork without leaving your agent session.

## Flow

1. Ask which source to connect (if not specified):

```
Available sources:
- github    — Uses GITHUB_PERSONAL_ACCESS_TOKEN from env
- gitlab    — Token + optional self-hosted URL
- linear    — API key from Linear settings
- posthog   — API key + optional self-hosted host
- feishu    — App ID + App Secret from Feishu developer console
- slack     — Bot token from Slack app settings (planned)
```

2. For each source, collect credentials non-interactively:

**GitHub:**
```bash
# Check if token already in env
[ -n "$GITHUB_PERSONAL_ACCESS_TOKEN" ] && echo "TOKEN_FOUND" || echo "TOKEN_MISSING"
```
If found: `jowork connect github --token "$GITHUB_PERSONAL_ACCESS_TOKEN"`
If missing: Ask user to provide token or set env var.

**GitLab:**
Ask for token via AskUserQuestion. Then:
```bash
jowork connect gitlab --token "<token>" [--api-url "<url>"]
```

**Linear:**
Ask for API key. Then: `jowork connect linear --api-key "<key>"`

**PostHog:**
Ask for API key + project ID. Then: `jowork connect posthog --api-key "<key>" --project-id "<id>"`

**Feishu:**
Ask for App ID + App Secret. Then: `jowork connect feishu --app-id "<id>" --app-secret "<secret>"`

3. After connecting, immediately trigger sync:
```bash
jowork sync --source <source>
```

4. Report results: "Connected <source>. Synced N objects. Your agent can now search this data."

## Security

- Never log or display tokens/secrets in output
- Credentials are stored in `~/.jowork/credentials/` with chmod 600
- Use AskUserQuestion for credential input (not Bash read)
