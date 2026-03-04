# Jowork Quick Start

> **Get Jowork running in under 5 minutes.**

---

## Option A: Desktop App (Recommended)

The easiest way to run Jowork. No server, no Docker — it works like VS Code.

### 1. Download

Visit [github.com/fluxvita/jowork/releases/latest](https://github.com/fluxvita/jowork/releases/latest) and download:

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Jowork-x.x.x-aarch64.dmg` |
| macOS (Intel) | `Jowork-x.x.x-x86_64.dmg` |
| Windows | `Jowork-x.x.x-setup.exe` |

### 2. Install & Open

- **macOS**: Open the `.dmg`, drag Jowork to Applications, then open it.
- **Windows**: Run the `.exe` installer.

### 3. Configure Your LLM

On first launch, Jowork asks for an LLM API key:

| Provider | Where to get a key |
|---|---|
| Anthropic | [console.anthropic.com](https://console.anthropic.com) |
| OpenAI | [platform.openai.com](https://platform.openai.com) |
| Local (Ollama) | `ollama serve` — no key needed |

You can change the model later in **Settings → AI Model**.

### 4. Add Your First Data Source

Go to **Connectors** → **Add Connector** and choose a source:

- **GitHub** — connect your repos for code-aware AI
- **Linear** — project management context
- **Notion** — docs and knowledge base
- **Feishu / Lark** — messages and calendar

### 5. Chat with Jowork

Open **Chat** → start a new session → try:

```
Summarize what happened in our main repo this week
```

---

## Option B: Docker (Server Deployment)

Run Jowork as a background service accessible by your whole team.

### Prerequisites

- Docker 24+ and Docker Compose v2
- 1 GB free RAM, 2 GB free disk

### 1. Create `docker-compose.yml`

```yaml
services:
  jowork:
    image: ghcr.io/fluxvita/jowork:latest
    ports:
      - "18800:18800"
    volumes:
      - jowork_data:/data
    environment:
      MODEL_PROVIDER: anthropic          # or: openai, ollama
      ANTHROPIC_API_KEY: sk-ant-...      # your API key
      # OPENAI_API_KEY: sk-...           # if using OpenAI
      # MODEL_NAME: claude-3-5-sonnet-latest
    restart: unless-stopped

volumes:
  jowork_data:
```

### 2. Start

```bash
docker compose up -d
```

Open [http://localhost:18800](http://localhost:18800) — Jowork is running!

### 3. First Login

In personal mode (default), no login is required. For team mode with multiple users:

```yaml
# Add to environment:
PERSONAL_MODE: "false"
```

Then create the first owner account at `/setup`.

---

## Option C: From Source

For contributors and developers who want to modify Jowork.

### Prerequisites

- Node.js 22+ (`node --version`)
- pnpm 10+ (`npm install -g pnpm`)
- Git

### 1. Clone

```bash
git clone https://github.com/fluxvita/jowork.git
cd jowork
```

### 2. Install Dependencies

```bash
pnpm install
```

### 3. Configure

```bash
cp .env.example .env
# Edit .env — at minimum, set MODEL_PROVIDER and the API key
```

Key environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `18800` | Gateway HTTP port |
| `MODEL_PROVIDER` | `anthropic` | LLM provider (anthropic / openai / ollama) |
| `ANTHROPIC_API_KEY` | — | Required for Anthropic |
| `OPENAI_API_KEY` | — | Required for OpenAI |
| `MODEL_NAME` | `claude-3-5-sonnet-latest` | Model ID |
| `DATA_DIR` | OS default | Where Jowork stores its SQLite database |
| `PERSONAL_MODE` | `true` | `false` = multi-user mode with login |

### 4. Build & Run

```bash
pnpm --filter @jowork/core build
node apps/jowork/dist/index.js
```

Open [http://localhost:18800](http://localhost:18800).

### 5. Development Mode (hot reload)

```bash
pnpm --filter @jowork/core build --watch &
nodemon apps/jowork/dist/index.js
```

---

## Connecting Jowork to Your Tools

### GitHub

1. Create a Personal Access Token at [github.com/settings/tokens](https://github.com/settings/tokens)
   - Scopes: `repo`, `read:org`
2. In Jowork → **Connectors** → **Add** → **GitHub**
3. Enter the token and your organization/username

### Linear

1. Get an API key at [linear.app/settings/api](https://linear.app/settings/api)
2. In Jowork → **Connectors** → **Add** → **Linear**

### Notion

1. Create an integration at [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. Share the pages you want Jowork to read with the integration
3. In Jowork → **Connectors** → **Add** → **Notion**

### Telegram

Add the Telegram channel to receive Jowork messages on your phone:

```bash
# In .env:
TELEGRAM_BOT_TOKEN=<your bot token from @BotFather>
TELEGRAM_CHAT_ID=<your chat ID>
```

---

## Upgrading

### Desktop App

Jowork checks for updates automatically. When a new version is available, you'll see a
notification in the top bar. Click **Update** to install.

To force-check: **Help** → **Check for Updates**.

### Docker

```bash
docker compose pull && docker compose up -d
```

### From Source

```bash
git pull
pnpm install
pnpm --filter @jowork/core build
```

---

## Troubleshooting

**Q: Jowork starts but I can't connect to my GitHub repo.**
A: Check that your Personal Access Token has `repo` scope and hasn't expired. In Jowork → **Connectors** → click on the GitHub connector → **Test Connection**.

**Q: LLM calls are failing with authentication errors.**
A: Verify your API key is correct. For Anthropic, keys start with `sk-ant-`. Check the **Logs** panel (bottom bar) for the exact error.

**Q: The database seems corrupted after an unexpected shutdown.**
A: Jowork runs SQLite in WAL mode, which is crash-safe. On next startup it runs `PRAGMA integrity_check` automatically. If it fails, restore from the last backup at **Settings → Data Management → Restore from Backup**.

**Q: I forgot my admin password (team mode).**
A: Stop Jowork, open the SQLite database with `sqlite3 data/jowork.db`, and run:
```sql
UPDATE users SET password_hash = NULL WHERE role = 'owner';
```
Then restart and set a new password via the setup page.

---

## Next Steps

- [Architecture Overview](./architecture.md)
- [API Reference](https://docs.jowork.work/api)
- [Building a Connector](https://docs.jowork.work/connectors)
- [Building a Skill](https://docs.jowork.work/skills)
- [Deployment Guide](./custom-domain.md)
