<div align="center">

<img src="https://raw.githubusercontent.com/fluxvita/jowork/main/docs/assets/jowork-logo.png" alt="Jowork" width="80" />

# Jowork

**Your AI coworker that actually knows your business.**

**真正懂你业务的 AI 工作伙伴。**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![GitHub Stars](https://img.shields.io/github/stars/fluxvita/jowork?style=social)](https://github.com/fluxvita/jowork)
[![Discord](https://img.shields.io/discord/placeholder?label=Discord&logo=discord&logoColor=white)](https://discord.gg/jowork)
[![Docker Pulls](https://img.shields.io/docker/pulls/ghcr.io/fluxvita/jowork)](https://github.com/fluxvita/jowork/pkgs/container/jowork)
[![中文](https://img.shields.io/badge/语言-中文%2FEnglish-blue)](#-中文说明)

[**Website**](https://jowork.work) · [**Docs**](https://docs.jowork.work) · [**Discord**](https://discord.gg/jowork) · [**Pricing**](https://jowork.work/pricing)

<br/>


</div>

---

## What is Jowork?

Jowork is an **open-source, self-hosted AI coworker** that deeply connects to your company's data sources — code repos, project management, docs, calendars, analytics — and works alongside your team 24/7.

Unlike ChatGPT or Notion AI, Jowork doesn't just answer questions. It **knows your actual business context**, can **execute tasks autonomously**, and runs entirely on **your own infrastructure**.

| | ChatGPT / Notion AI | Dust.tt / Glean | **Jowork** |
|---|---|---|---|
| Knows your business | ❌ No context | ✅ Read-only | ✅ **Deep + writable** |
| Runs autonomously | ❌ | ❌ | ✅ **Event-driven + goal-based** |
| Self-hosted | ❌ SaaS only | ❌ SaaS only | ✅ **Your server, your data** |
| Can take action | ❌ Chat only | ❌ Search only | ✅ **Claude Code-level execution** |
| Data ownership | ☁️ Vendor lock-in | ☁️ Vendor lock-in | 🏠 **100% yours** |

---

## ✨ Features

### 🔌 Connect Everything
Connect all your tools and let Jowork understand your full business context.

- **Git** — GitHub, GitLab (code, PRs, issues)
- **Project Management** — Linear, Jira, Notion
- **Communication** — Slack, Discord, Lark/Feishu
- **Analytics** — PostHog, Mixpanel
- **Documents** — Google Drive, Confluence, Figma
- **Calendar & Email** — Google, Outlook
- **Custom** — Any REST API via [Jowork Connect Protocol](https://docs.jowork.work/jcp)

### 🤖 Autonomous Agent
Don't just ask — let Jowork act.

- **Scheduled tasks** — "Summarize last week's PRs every Monday at 9am"
- **Event-triggered** — "When a P0 bug is filed, ping the on-call and draft a fix"
- **Goal-driven** — "Monitor our signup funnel and tell me if conversion drops >10%"
- **Tool-calling** — Execute shell commands, write files, create PRs, send messages

### 📚 Deep Context
Jowork builds a continuously-updated understanding of your business.

- **Company context** — Mission, culture, glossary, architecture decisions
- **Team context** — Processes, OKRs, communication style
- **Personal context** — Your work style, recurring tasks, preferences
- **Semantic memory** — Remembers past conversations and decisions

### 💻 Geek Mode
For developers who want full control.

- **Integrated terminal** — Run commands directly in the UI
- **Code execution** — Sandboxed shell with allowlist
- **MCP protocol** — Connect any MCP-compatible tool
- **Custom Skills** — Write your own agent behaviors in JS

---

## 🚀 Quick Start

### Docker (Recommended)

```bash
# One-liner
docker run -d \
  --name jowork \
  -p 18800:18800 \
  -v ./jowork-data:/app/data \
  -e ANTHROPIC_API_KEY=your_key_here \
  ghcr.io/fluxvita/jowork:latest

# Or with docker compose (recommended for production)
curl -O https://raw.githubusercontent.com/fluxvita/jowork/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/fluxvita/jowork/main/.env.example
cp .env.example .env && nano .env   # set ANTHROPIC_API_KEY
docker compose up -d
```

Open [http://localhost:18800](http://localhost:18800) and follow the setup wizard. That's it.

### Desktop App (macOS / Windows)

Download the latest release:

| Platform | Download |
|---|---|
| macOS (Apple Silicon) | [Jowork-x.x.x-aarch64.dmg](https://github.com/fluxvita/jowork/releases/latest) |
| macOS (Intel) | [Jowork-x.x.x-x86_64.dmg](https://github.com/fluxvita/jowork/releases/latest) |
| Windows | [Jowork-x.x.x-setup.exe](https://github.com/fluxvita/jowork/releases/latest) |

The desktop app bundles a local Gateway — no server setup required. Opens like VS Code.

### From Source

```bash
git clone https://github.com/fluxvita/jowork
cd jowork
pnpm install
pnpm --filter @jowork/core build
pnpm --filter @jowork/app build
node apps/jowork/dist/index.js
# → http://localhost:18800
```

Requirements: Node.js 22+, pnpm 10+, macOS/Linux/Windows

---

## 📦 Packages

Jowork is a monorepo. You can use the core packages in your own projects:

```bash
npm install @jowork/core        # Core Gateway + Agent engine
npm install @jowork/connector-github   # GitHub connector
npm install @jowork/connector-linear   # Linear connector
# ... more connectors at npmjs.com/search?q=%40jowork
```

---

## 🗺️ Roadmap

- [x] Agent loop with tool calling (15 built-in tools)
- [x] 7 connectors (Git, Linear, Feishu, PostHog, Figma, Email, OSS)
- [x] Three-layer context system (Company / Team / Personal)
- [x] Semantic memory with vector search
- [x] Desktop app (macOS + Windows) with local gateway
- [x] MCP protocol support
- [x] Real-time streaming (SSE)
- [x] Docker one-command deployment (`docker compose up -d`)
- [x] GitHub + Notion connectors
- [x] Telegram channel (webhook + long-poll)
- [x] i18n support (English + Chinese, extensible)
- [ ] Sub-agent orchestration (Premium)
- [ ] Event-driven triggers (Premium)
- [ ] Goal-driven autonomous mode (Premium)
- [ ] Mobile app (iOS / Android)
- [ ] PostgreSQL support (for 100+ users)

---

## 💰 Pricing

Jowork core is **free and open-source** (AGPL-3.0). Premium features are available for teams and businesses.

| | **Free** | **Pro** $12/mo | **Team** $49/mo | **Business** $199/mo |
|---|---|---|---|---|
| Data sources | 3 | 10 | Unlimited | Unlimited |
| Users | 1 | 1 | 10 | Unlimited |
| Context window | 32K tokens | 100K tokens | 100K tokens | 200K tokens |
| Scheduled tasks | 5 | 20 | Unlimited | Unlimited |
| Terminal (Geek Mode) | ✅ Basic | ✅ Full | ✅ Full | ✅ Full |
| Sub-agent orchestration | ❌ | ❌ | ✅ | ✅ |
| Event triggers | ❌ | ❌ | ✅ | ✅ |
| Audit log | ❌ | ❌ | ❌ | ✅ |
| SSO / SAML | ❌ | ❌ | ❌ | ✅ |
| Support | Community | Priority Issues | Email | Dedicated |

[View full pricing →](https://jowork.work/pricing)

Self-hosted forever free for personal use. No usage limits, no phone home.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────┐
│                  Jowork Desktop                  │
│           (Tauri + Local Gateway Sidecar)         │
└──────────────────┬──────────────────────────────┘
                   │ HTTP / SSE
┌──────────────────▼──────────────────────────────┐
│              Gateway (Express 5 + SQLite)         │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Agent   │  │  Connectors │  │  Scheduler │  │
│  │  Engine  │  │  (7 sources)│  │  (cron)    │  │
│  └──────────┘  └─────────────┘  └────────────┘  │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Memory  │  │  MCP Bridge │  │  Skills    │  │
│  │  (FTS5 + │  │             │  │  Executor  │  │
│  │  Vector) │  └─────────────┘  └────────────┘  │
│  └──────────┘                                    │
└─────────────────────────────────────────────────┘
```

- **Gateway**: Express 5 + TypeScript, REST + SSE + WebSocket
- **Database**: SQLite (better-sqlite3) with FTS5 full-text search
- **Desktop**: Tauri (Rust) with bundled Gateway sidecar
- **Agent**: Dual-engine (built-in 25-turn loop + Claude Agent SDK)
- **Memory**: Semantic vector search (Moonshot embeddings) + keyword fallback

---

## 🤝 Contributing

We welcome contributions! Jowork is built for the community.

```bash
git clone https://github.com/fluxvita/jowork
cd jowork
npm install
npm run dev       # Start with hot reload
npm test          # Run test suite (116 cases)
npm run lint      # TypeScript + ESLint
```

Before contributing, please:
1. Read [CONTRIBUTING.md](./CONTRIBUTING.md)
2. Sign the [Contributor License Agreement](https://cla-assistant.io/fluxvita/jowork) (CLA)
3. Check [open issues](https://github.com/fluxvita/jowork/issues) — look for `good first issue`

**Building a connector?** → [Jowork Connect Protocol docs](https://docs.jowork.work/jcp)
**Building a skill?** → [Skills API docs](https://docs.jowork.work/skills)
**Discussing the roadmap?** → [GitHub Discussions](https://github.com/fluxvita/jowork/discussions)

---

## 🌐 中文说明

**Jowork** 是一个**开源、自托管的 AI 工作伙伴**，深度连接你的公司数据源（代码仓库、项目管理、文档、日历、数据分析），24/7 与你的团队协同工作。

### 快速开始

```bash
# Docker 一键部署
docker run -d --name jowork -p 18800:18800 \
  -v ./jowork-data:/app/data \
  -e ANTHROPIC_API_KEY=你的密钥 \
  ghcr.io/fluxvita/jowork:latest
# 浏览器打开 http://localhost:18800
```

```bash
# 或从源码运行
git clone https://github.com/fluxvita/jowork
cd jowork && pnpm install && pnpm build
node apps/jowork/dist/index.js
```

### 主要功能

- 🔌 **连接一切** — GitHub/GitLab、Linear、飞书/Slack、PostHog、Figma、邮件
- 🤖 **自主 Agent** — 定时任务、事件触发、目标驱动、工具调用（执行命令、创建 PR、发消息）
- 📚 **深度上下文** — 公司级/团队级/个人级三层上下文，语义向量记忆
- 💻 **极客模式** — 内置终端、代码执行、MCP 协议、自定义 Skills

### 语言切换

UI 支持中英双语，点击侧边栏底部的 **「中 / EN」** 按钮即可切换。自动检测浏览器语言。

### 许可证

核心代码 [AGPL-3.0](./LICENSE) · 个人使用永久免费 · 无用量限制

---

## 📄 License

- **Core** (`packages/core`, `apps/jowork`): [AGPL-3.0](./LICENSE)
- **Premium** (`packages/premium`): [Commercial License](./LICENSE-PREMIUM)
- **Connectors** (`packages/connector-*`): MIT

AGPL-3.0 means: you can use, modify, and distribute Jowork for free — including commercially — as long as you open-source your modifications under the same license. If you need a proprietary license, [contact us](mailto:hello@jowork.work).

### AGPL-3.0 Compliance FAQ

<details>
<summary><strong>Can I use Jowork internally at my company without open-sourcing anything?</strong></summary>

Yes. Running Jowork internally (only your employees use it) does **not** require you to
publish your source code. AGPL's network-use clause only applies when you make the
software available to external users over a network.
</details>

<details>
<summary><strong>I modified Jowork Core and offer it as a SaaS to customers. What do I need to do?</strong></summary>

Under AGPL-3.0, you must make your modified source code available to those customers
(e.g., a link to a public repository). You do not need to publish your proprietary
data or configurations — only the modified Jowork source code.
</details>

<details>
<summary><strong>Can I build a proprietary product on top of Jowork?</strong></summary>

If you only call Jowork's HTTP API (without modifying or distributing its source code),
your application is **not** subject to AGPL. If you modify or bundle Jowork Core,
the AGPL applies to the Core. Contact us for a [commercial license](mailto:hello@jowork.work)
if you need to keep your modifications proprietary.
</details>

<details>
<summary><strong>Does the premium package (packages/premium) have different terms?</strong></summary>

Yes. `packages/premium` is under a commercial license. You need a valid Jowork Premium
subscription to use it. See [jowork.work/pricing](https://jowork.work/pricing).
</details>

<details>
<summary><strong>I'm a contributor — do I need to sign a CLA?</strong></summary>

Yes. We use a [Contributor License Agreement](https://cla-assistant.io/fluxvita/jowork)
to allow us to dual-license contributions (AGPL + commercial). The CLA is signed once
via GitHub and does not restrict your own use of your contributions.
</details>

Full legal documents: [Terms of Service](./docs/legal/terms-of-service.md) · [Privacy Policy](./docs/legal/privacy-policy.md) · [Refund Policy](./docs/legal/refund-policy.md)

---

<div align="center">

Built with ❤️ by [FluxVita](https://fluxvita.com) · [Website](https://jowork.work) · [Twitter](https://twitter.com/jowork_ai) · [Discord](https://discord.gg/jowork)

</div>
