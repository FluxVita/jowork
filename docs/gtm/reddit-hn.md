# Jowork — Reddit & Hacker News Launch Copy

> **Review and personalize these drafts before posting. Reddit posts perform best when they feel authentic — adapt the voice to your own.**

---

## Hacker News: Show HN

### Title

```
Show HN: Jowork – open-source self-hosted AI coworker that connects to your tools
```

Alternative titles:
```
Show HN: Jowork – self-hosted AI that knows your codebase, docs, and PM tools
Show HN: Jowork – open-source alternative to Dust/Glean with autonomous agent mode
```

### Body (250–400 words)

```
Hi HN,

I've been building Jowork (https://github.com/fluxvita/jowork) — an open-source,
self-hosted AI coworker that connects to your actual business data and can act on it.

**The problem I was trying to solve:**

Most AI tools I've tried (including some expensive enterprise ones) are essentially
chat interfaces that know nothing about my actual company. Every new chat starts from
scratch. I wanted an AI that remembers our conventions, knows our current project state,
and can take action — not just answer questions.

**What Jowork does:**

- Connects to GitHub, Linear, Notion, Feishu, PostHog, Figma via native connectors
- Builds a "three-layer context": company knowledge (runbooks, docs), team context
  (sprint state, open issues), personal preferences (coding style, shortcuts)
- Runs autonomous tasks: "every Monday morning, summarize the week's PRs and post
  to Slack"
- Event-driven: "when a P0 bug is filed on Linear, ping the on-call and draft a fix plan"
- Entirely self-hosted — SQLite database, your own LLM API key, runs on a Mac mini
  or VPS

**Tech stack:**
Node.js/TypeScript, Express 5, SQLite with FTS5, Vue 3 (CDN, no build step for UI),
Tauri for desktop. Monorepo with pnpm workspaces.

**What makes it different from Dust.tt, Glean, etc.:**
Those are SaaS — your data goes to their servers. Jowork runs entirely on your hardware.
The core (AGPL-3.0) is free forever; Premium adds sub-agent orchestration, event
triggers, and advanced RBAC for teams.

Happy to answer questions about the architecture, the agent loop design, or why I chose
SQLite over Postgres.

GitHub: https://github.com/fluxvita/jowork
Demo: https://jowork.work
```

---

## Reddit: r/selfhosted

### Title

```
Jowork – open-source self-hosted AI coworker that connects to GitHub, Linear, Notion, and more
```

### Body

```
Hey r/selfhosted!

I just open-sourced Jowork, a self-hosted AI coworker I've been building.

**What it is:**
An AI assistant that actually knows your company's context — connects to your code repos,
project management, docs, and analytics, then lets you ask questions and run autonomous
tasks, all on your own hardware.

**Self-hosted features:**
- Runs on macOS, Linux, or Windows (Docker image available)
- SQLite database — no external services needed
- Your LLM API key goes directly to Anthropic/OpenAI, not through any proxy
- Data stays on your server; no telemetry unless you opt in
- Works offline (Ollama supported for fully local LLMs)

**Supported connectors:**
- GitHub (code, PRs, issues)
- Linear (project management)
- Notion (docs, wikis)
- Feishu/Lark (messages, calendar — great for Asian companies)
- PostHog (analytics events)
- Figma (design specs)
- Email (IMAP/SMTP)

**Autonomous tasks:**
Schedule tasks like "summarize our sprint every Monday" or trigger on events like
"when a customer churns in PostHog, draft a win-back email."

**Setup:**

```
docker compose up -d
# → http://localhost:18800
```

Or download the desktop app (macOS/Windows) — it bundles its own local server.

**License:** AGPL-3.0 for the core. Everything you need for personal/team self-hosting
is in the free tier.

GitHub: https://github.com/fluxvita/jowork

Would love feedback on the feature set and what connectors you'd most want to see!
```

---

## Reddit: r/LocalLLaMA

### Title

```
Jowork – self-hosted AI coworker with Ollama support, connects to your dev tools
```

### Body

```
Hi r/LocalLLaMA,

Built something I think the community will appreciate: Jowork, a self-hosted AI
coworker that works with Ollama for a fully local setup.

**Why it's relevant here:**

You can run Jowork with zero cloud API calls:
- Point it at your local Ollama instance
- All data stored locally in SQLite
- No telemetry, no phone-home

**Tested with Ollama:**
- llama3.2 (good for general tasks)
- qwen2.5 (good for code)
- mistral (fast responses)

**What Jowork does on top of raw Ollama:**
- Persistent context: remembers your project docs, coding conventions, current sprint
- Connector integrations: GitHub, Linear, Notion — so the LLM has actual context
- Autonomous scheduling: runs tasks even when you're not actively chatting
- Multi-model routing: use local models for routine queries, API models for complex ones

**Setup:**

```bash
# 1. Start Ollama
ollama pull llama3.2

# 2. Start Jowork
MODEL_PROVIDER=ollama MODEL_NAME=llama3.2 node apps/jowork/dist/index.js
```

GitHub: https://github.com/fluxvita/jowork

Curious what models you'd use for different agent tasks — always looking to improve
the default routing.
```

---

## Reddit: r/programming / r/webdev

### Title

```
I open-sourced Jowork: a self-hosted AI coworker built with Node.js, SQLite, and Vue 3 (no build step)
```

### Body

```
tl;dr: [GitHub link] — feedback welcome, especially on the architecture

---

Built Jowork over the past few months — a self-hosted AI coworker that connects to
GitHub, Linear, Notion, and other tools, and can run autonomous tasks.

**A few tech choices I made that I think are interesting:**

**SQLite instead of Postgres:** For a single-tenant self-hosted tool, SQLite in WAL
mode handles everything we need. FTS5 for full-text search on memory/context docs.
Startup integrity_check + automatic backups via hot backup API. No external dependencies.

**Vue 3 via CDN (no build step):** The admin UI is served directly as HTML + CDN
Vue. No webpack, no Vite, no node_modules for the frontend. Eliminates an entire
class of build failures.

**Bun `--compile` for the Gateway sidecar:** In the Tauri desktop app, the Node.js
gateway runs as a single compiled Bun binary. ~40MB, zero runtime dependencies, works
like a native binary.

**Express 5 for the API:** The new wildcard syntax (`/{*path}`) and built-in async
error handling cleaned up a lot of boilerplate.

**Three-layer context assembly:** Company / Team / Personal layers, assembled per-request
based on user role and sensitivity level. Works reasonably well for keeping context
relevant without blowing the token budget.

The codebase is AGPL-3.0. Happy to discuss any of the architectural decisions.

GitHub: https://github.com/fluxvita/jowork
```

---

*Last updated: 2026-03-05. Personalize and update before posting.*
