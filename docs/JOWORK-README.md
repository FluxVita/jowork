<div align="center">

<img src="https://raw.githubusercontent.com/fluxvita/jowork/main/docs/assets/jowork-logo.svg" alt="Jowork" width="80" />

# Jowork

**Your AI coworker that actually knows your business.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![GitHub Stars](https://img.shields.io/github/stars/fluxvita/jowork?style=social)](https://github.com/fluxvita/jowork)
[![Discord](https://img.shields.io/discord/placeholder?label=Discord&logo=discord&logoColor=white)](https://discord.gg/jowork)
[![Docker Pulls](https://img.shields.io/docker/pulls/ghcr.io/fluxvita/jowork)](https://github.com/fluxvita/jowork/pkgs/container/jowork)

[**Website**](https://jowork.work) · [**Docs**](https://docs.jowork.work) · [**Discord**](https://discord.gg/jowork) · [**Pricing**](https://jowork.work/pricing)

<br/>

![Jowork Demo](https://raw.githubusercontent.com/fluxvita/jowork/main/docs/assets/demo.gif)

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
docker run -d \
  --name jowork \
  -p 18800:18800 \
  -v ./jowork-data:/app/data \
  ghcr.io/fluxvita/jowork:latest
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

Jowork is a monorepo. The currently published/runtime packages are:

```bash
npm install @jowork/core        # Core Gateway + Agent engine
npm install @jowork/premium     # Premium extension package (commercial)
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
- [ ] Docker one-command deployment
- [ ] GitHub, Slack, Notion connectors
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
npm test          # Run test suite
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

## 📄 License

- **Core** (`packages/core`, `apps/jowork`): [AGPL-3.0](./LICENSE)
- **Premium** (`packages/premium`): [Commercial License](./LICENSE-PREMIUM)
- **Connectors**: bundled in `@jowork/core` (no standalone `packages/connector-*` in this repo)

AGPL-3.0 means: you can use, modify, and distribute Jowork for free — including commercially — as long as you open-source your modifications under the same license. If you need a proprietary license, [contact us](mailto:hello@jowork.work).

---

<div align="center">

Built with ❤️ by [FluxVita](https://fluxvita.com) · [Website](https://jowork.work) · [Twitter](https://twitter.com/jowork_ai) · [Discord](https://discord.gg/jowork)

</div>
