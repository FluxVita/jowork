# Jowork Installation Guide

This guide covers all installation methods for Jowork.

---

## Requirements

| Component    | Minimum Version | Notes                                  |
|--------------|-----------------|----------------------------------------|
| Node.js      | 22.0.0          | LTS recommended                        |
| pnpm         | 9.0.0           | `npm i -g pnpm` to install             |
| SQLite       | Built-in        | Provided via `better-sqlite3`          |
| Docker       | 20.0+           | Optional, for Docker-based deployment  |
| Docker Compose | 2.0+          | Optional                               |

**Supported platforms:**
- macOS (ARM64 / Intel) — primary development platform
- Linux (x86_64 / ARM64) — Docker and server deployments
- Windows 10/11 (x86_64) — via Docker or Node.js directly

---

## Method 1: Docker (Recommended for Production)

The easiest way to self-host Jowork.

### Step 1: Get the config files

```bash
# Option A: Clone the full repo
git clone https://github.com/fluxvita/jowork && cd jowork

# Option B: Just download the config files
curl -O https://raw.githubusercontent.com/fluxvita/jowork/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/fluxvita/jowork/main/.env.example
```

### Step 2: Configure

```bash
cp .env.example .env
```

Open `.env` and set at minimum:

```env
# Security — REQUIRED, generate with: openssl rand -hex 32
JWT_SECRET=your-random-secret-here

# AI Model — at least one is required
MOONSHOT_API_KEY=sk-...
# or OPENAI_API_KEY=sk-...
```

### Step 3: Start

```bash
docker-compose up -d
```

Jowork is now running at **http://localhost:18800**.

### Updating

```bash
docker-compose pull && docker-compose up -d
```

### Data persistence

All data (database, uploads) is stored in `./data/`. Back this up regularly.

```bash
# Simple backup
cp -r ./data ./data.backup.$(date +%Y%m%d)
```

---

## Method 2: From Source

Best for development or when you want to customize Jowork.

### Step 1: Clone

```bash
git clone https://github.com/fluxvita/jowork
cd jowork
```

### Step 2: Install dependencies

```bash
# Install pnpm if not already installed
npm install -g pnpm

# Install all workspace dependencies
pnpm install
```

### Step 3: Build

```bash
# Build core package first (required dependency)
pnpm --filter @jowork/core build

# Build the app
pnpm --filter @jowork/app build
```

### Step 4: Configure

```bash
cp .env.example .env
# Edit .env with your settings
```

### Step 5: Run

```bash
# Production
pnpm --filter @jowork/app start

# Development (hot reload)
pnpm --filter @jowork/app dev
```

Open **http://localhost:18800** (dev) or the port configured in `JOWORK_PORT`.

---

## Method 3: Build Your Own Docker Image

If you want to run a custom build:

```bash
git clone https://github.com/fluxvita/jowork
cd jowork

# Build the image
docker build -t jowork:local .

# Run it
docker run -d \
  -p 18800:18800 \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/.env:/app/.env:ro \
  --name jowork \
  jowork:local
```

---

## First-Time Setup

On first launch, Jowork runs an onboarding flow:

1. **Create account** — Enter a username and password (local auth, no external service needed)
2. **Connect tools** — Add API keys for the services you want to sync
3. **Set up workspace** — Describe your role and work context (helps the AI)
4. **Done** — Start chatting

---

## Connecting Services

After setup, connect your tools in the **Admin** panel → **Connectors** tab.

### GitLab

1. Go to GitLab → User Settings → Access Tokens
2. Create token with `read_api` scope
3. In Jowork Admin → Add Connector → GitLab → paste token and URL

### GitHub

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens
2. Create token with `repo` and `read:org` scopes
3. In `.env`, set `GITHUB_TOKEN` and `GITHUB_REPOS=owner/repo1,owner/repo2`

### Linear

1. Go to Linear → Settings → API → Personal API Keys
2. Create key with full access
3. Set `LINEAR_API_KEY` in `.env`

### Notion

1. Go to https://www.notion.so/my-integrations
2. Create a new integration (type: internal)
3. Copy the "Internal Integration Token"
4. Share relevant pages/databases with your integration in Notion
5. Set `NOTION_TOKEN` in `.env`

### Telegram Bot

1. Message @BotFather on Telegram: `/newbot`
2. Follow instructions to create a bot, copy the token
3. Set `TELEGRAM_BOT_TOKEN` in `.env`
4. Set `TELEGRAM_MODE=polling` for local dev, `webhook` for production

---

## AI Models

Jowork supports multiple AI providers. Set at least one:

| Provider   | Env Variable          | Notes                                |
|------------|-----------------------|--------------------------------------|
| Moonshot   | `MOONSHOT_API_KEY`    | Good performance, affordable         |
| OpenAI     | `OPENAI_API_KEY`      | Set model with `OPENAI_MODEL`        |
| Anthropic  | `ANTHROPIC_API_KEY`   | Claude models                        |
| Ollama     | Set `OLLAMA_ENDPOINT` | Local models, no API key needed      |

### Optional: telemetry opt-in (self-hosted)

By default, open-source telemetry is disabled. You can explicitly enable it:

```env
JOWORK_TELEMETRY_ENABLED=true
```

Or manage it in runtime via API (admin only):

- `GET /api/system/telemetry`
- `POST /api/system/telemetry` with `{ "enabled": true|false }`

---

## Reverse Proxy (Production)

### nginx

```nginx
server {
    listen 443 ssl;
    server_name jowork.yourdomain.com;

    # SSL config here (use certbot/Let's Encrypt)

    location / {
        proxy_pass http://127.0.0.1:18800;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';

        # Required for streaming AI responses (SSE)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

### Caddy

```caddyfile
jowork.yourdomain.com {
    reverse_proxy localhost:18800 {
        flush_interval -1   # Required for SSE streaming
    }
}
```

---

## System Service

### Linux (systemd)

```ini
# /etc/systemd/system/jowork.service
[Unit]
Description=Jowork AI Work Partner
After=network.target

[Service]
Type=simple
User=jowork
WorkingDirectory=/opt/jowork
ExecStart=/usr/bin/node apps/jowork/dist/index.js
Restart=on-failure
RestartSec=10
EnvironmentFile=/opt/jowork/.env
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jowork
sudo journalctl -fu jowork
```

### macOS (launchd)

```xml
<!-- ~/Library/LaunchAgents/com.jowork.plist -->
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.jowork</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/path/to/jowork/apps/jowork/dist/index.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>/path/to/jowork</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/jowork.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/jowork-err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.jowork.plist
```

---

## Troubleshooting

### Port already in use

```bash
# Find what's using the port
lsof -i :18800
# Kill it or change JOWORK_PORT in .env
```

### Database locked error

Jowork uses SQLite. Only one process should access the database at a time. If you see "database is locked", ensure no other Jowork instance is running.

### Connector sync fails

Check the logs:
```bash
# Docker
docker-compose logs -f jowork

# From source
# Logs are printed to stdout / stored in LOG_DIR
```

Common causes:
- Invalid API key — verify in the service's developer console
- Rate limits — Jowork backs off automatically; wait a few minutes
- Network issues — check firewall / proxy settings

### Out of memory

Jowork's embedding and sync tasks can be memory-intensive. Minimum recommended: 512MB RAM. Set `NODE_OPTIONS=--max-old-space-size=512` if needed.

---

## Upgrading

### Docker
```bash
docker-compose pull && docker-compose up -d
```

### From source
```bash
git pull
pnpm install
pnpm --filter @jowork/core build
pnpm --filter @jowork/app build
# Restart the process
```

Database migrations run automatically on startup.

---

## Uninstalling

```bash
# Docker
docker-compose down -v    # -v also removes the data volume if mounted as named volume
rm -rf ./data             # Remove data files

# From source: just delete the directory
```

---

## Getting Help

- [GitHub Issues](https://github.com/fluxvita/jowork/issues) — bug reports and feature requests
- [GitHub Discussions](https://github.com/fluxvita/jowork/discussions) — questions and community support
