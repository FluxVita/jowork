<div align="center">

<img src="https://raw.githubusercontent.com/fluxvita/jowork/main/docs/assets/jowork-logo.svg" alt="Jowork" width="80" />

# Jowork

**真正懂你业务的 AI 工作伙伴。**

**Your AI coworker that actually knows your business.**

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![GitHub Stars](https://img.shields.io/github/stars/fluxvita/jowork?style=social)](https://github.com/fluxvita/jowork)
[![Discord](https://img.shields.io/discord/placeholder?label=Discord&logo=discord&logoColor=white)](https://discord.gg/jowork)
[![Docker Pulls](https://img.shields.io/docker/pulls/ghcr.io/fluxvita/jowork)](https://github.com/fluxvita/jowork/pkgs/container/jowork)
[![English](https://img.shields.io/badge/语言-中文%2FEnglish-blue)](README.md)

[**官网**](https://jowork.work) · [**文档**](https://docs.jowork.work) · [**Discord**](https://discord.gg/jowork) · [**定价**](https://jowork.work/pricing)

<br/>

![Jowork Demo](https://raw.githubusercontent.com/fluxvita/jowork/main/docs/assets/demo.gif)

</div>

---

## Jowork 是什么？

Jowork 是一个**开源、自托管的 AI 工作伙伴**，深度连接你的公司数据源——代码仓库、项目管理、文档、日历、数据分析——24/7 与你的团队协同工作。

不同于 ChatGPT 或 Notion AI，Jowork 不只是回答问题。它**真正了解你的业务上下文**，能够**自主执行任务**，并完全运行在**你自己的基础设施**上。

| | ChatGPT / Notion AI | Dust.tt / Glean | **Jowork** |
|---|---|---|---|
| 了解你的业务 | ❌ 无上下文 | ✅ 只读 | ✅ **深度 + 可写** |
| 自主运行 | ❌ | ❌ | ✅ **事件驱动 + 目标导向** |
| 自托管 | ❌ 仅 SaaS | ❌ 仅 SaaS | ✅ **你的服务器，你的数据** |
| 可执行操作 | ❌ 仅对话 | ❌ 仅搜索 | ✅ **Claude Code 级别的执行力** |
| 数据所有权 | ☁️ 厂商锁定 | ☁️ 厂商锁定 | 🏠 **100% 属于你** |

---

## ✨ 功能特性

### 🔌 连接一切
连接所有工具，让 Jowork 理解你完整的业务上下文。

- **Git** — GitHub、GitLab（代码、PR、Issues）
- **项目管理** — Linear、Jira、Notion
- **沟通协作** — Slack、Discord、飞书
- **数据分析** — PostHog、Mixpanel
- **文档** — Google Drive、Confluence、Figma
- **日历与邮件** — Google、Outlook
- **自定义** — 任何 REST API，通过 [Jowork Connect Protocol](https://docs.jowork.work/jcp)

### 🤖 自主 Agent
不只是问答——让 Jowork 主动行动。

- **定时任务** — "每周一 9 点整理上周的 PR 摘要"
- **事件触发** — "当 P0 Bug 被提交，立即通知值班并起草修复方案"
- **目标导向** — "监控注册转化漏斗，转化率下降超 10% 时提醒我"
- **工具调用** — 执行 Shell 命令、写文件、创建 PR、发消息

### 📚 深度上下文
Jowork 持续更新对你业务的理解。

- **公司上下文** — 使命、文化、术语表、架构决策
- **团队上下文** — 流程、OKR、沟通风格
- **个人上下文** — 你的工作方式、重复任务、个人偏好
- **语义记忆** — 记住过去的对话和决策

### 💻 极客模式
为想要完全掌控的开发者而生。

- **集成终端** — 直接在 UI 中运行命令
- **代码执行** — 带白名单的沙箱 Shell
- **MCP 协议** — 连接任何 MCP 兼容工具
- **自定义 Skills** — 用 JS 编写你自己的 Agent 行为

---

## 🚀 快速开始

### Docker（推荐）

```bash
# 一行命令启动
docker run -d \
  --name jowork \
  -p 18800:18800 \
  -v ./jowork-data:/app/data \
  -e ANTHROPIC_API_KEY=你的密钥 \
  ghcr.io/fluxvita/jowork:latest

# 或用 docker compose（推荐生产环境）
curl -O https://raw.githubusercontent.com/fluxvita/jowork/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/fluxvita/jowork/main/.env.example
cp .env.example .env && nano .env   # 填入 ANTHROPIC_API_KEY
docker compose up -d
```

浏览器打开 [http://localhost:18800](http://localhost:18800)，按引导完成配置，搞定。

### 桌面应用（macOS / Windows）

下载最新版本：

| 平台 | 下载 |
|---|---|
| macOS（Apple Silicon） | [Jowork-x.x.x-aarch64.dmg](https://github.com/fluxvita/jowork/releases/latest) |
| macOS（Intel） | [Jowork-x.x.x-x86_64.dmg](https://github.com/fluxvita/jowork/releases/latest) |
| Windows | [Jowork-x.x.x-setup.exe](https://github.com/fluxvita/jowork/releases/latest) |

桌面应用内置本地 Gateway，无需任何服务器配置。像打开 VS Code 一样使用。

### 从源码运行

```bash
git clone https://github.com/fluxvita/jowork
cd jowork
pnpm install
pnpm --filter @jowork/core build
pnpm --filter @jowork/app build
node apps/jowork/dist/index.js
# → http://localhost:18800
```

环境要求：Node.js 22+、pnpm 10+、macOS/Linux/Windows

---

## 📦 软件包

Jowork 是 monorepo 架构，你可以在自己的项目中单独使用核心包：

```bash
npm install @jowork/core               # 核心 Gateway + Agent 引擎
npm install @jowork/connector-github   # GitHub 连接器
npm install @jowork/connector-linear   # Linear 连接器
# ... 更多连接器见 npmjs.com/search?q=%40jowork
```

---

## 🗺️ 路线图

- [x] 带工具调用的 Agent 循环（15 个内置工具）
- [x] 7 个连接器（Git、Linear、飞书、PostHog、Figma、邮件、OSS）
- [x] 三层上下文系统（公司级 / 团队级 / 个人级）
- [x] 带向量搜索的语义记忆
- [x] 桌面应用（macOS + Windows），内置本地 Gateway
- [x] MCP 协议支持
- [x] 实时流式输出（SSE）
- [x] Docker 一键部署（`docker compose up -d`）
- [x] GitHub + Notion 连接器
- [x] Telegram 频道（Webhook + 长轮询）
- [x] 国际化支持（中文 + 英文，可扩展）
- [ ] 子 Agent 编排（高级版）
- [ ] 事件驱动触发器（高级版）
- [ ] 目标驱动自主模式（高级版）
- [ ] 移动端（iOS / Android）
- [ ] PostgreSQL 支持（100+ 用户场景）

---

## 💰 定价

Jowork 核心功能**免费开源**（AGPL-3.0）。团队和企业版提供高级功能。

| | **免费版** | **Pro** ¥88/月 | **Team** ¥358/月 | **Business** ¥1458/月 |
|---|---|---|---|---|
| 数据源 | 3 | 10 | 无限制 | 无限制 |
| 用户数 | 1 | 1 | 10 | 无限制 |
| 上下文窗口 | 32K tokens | 100K tokens | 100K tokens | 200K tokens |
| 定时任务 | 5 | 20 | 无限制 | 无限制 |
| 终端（极客模式） | ✅ 基础 | ✅ 完整 | ✅ 完整 | ✅ 完整 |
| 子 Agent 编排 | ❌ | ❌ | ✅ | ✅ |
| 事件触发器 | ❌ | ❌ | ✅ | ✅ |
| 审计日志 | ❌ | ❌ | ❌ | ✅ |
| SSO / SAML | ❌ | ❌ | ❌ | ✅ |
| 支持 | 社区 | 优先 Issues | 邮件 | 专属 |

[查看完整定价 →](https://jowork.work/pricing)

个人使用永久免费，无用量限制，不回拨数据。

---

## 🏗️ 架构

```
┌─────────────────────────────────────────────────┐
│                  Jowork 桌面客户端                 │
│           (Tauri + 本地 Gateway Sidecar)          │
└──────────────────┬──────────────────────────────┘
                   │ HTTP / SSE
┌──────────────────▼──────────────────────────────┐
│              Gateway (Express 5 + SQLite)         │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  Agent   │  │  连接器      │  │  调度器    │  │
│  │  引擎    │  │  (7 个数据源)│  │  (cron)    │  │
│  └──────────┘  └─────────────┘  └────────────┘  │
│  ┌──────────┐  ┌─────────────┐  ┌────────────┐  │
│  │  记忆库  │  │  MCP 桥接   │  │  Skills    │  │
│  │  (FTS5 + │  │             │  │  执行器    │  │
│  │  向量)   │  └─────────────┘  └────────────┘  │
│  └──────────┘                                    │
└─────────────────────────────────────────────────┘
```

- **Gateway**：Express 5 + TypeScript，REST + SSE + WebSocket
- **数据库**：SQLite（better-sqlite3），FTS5 全文检索
- **桌面客户端**：Tauri（Rust），内置 Gateway sidecar
- **Agent**：双引擎（内置 25 轮 tool-calling 循环 + Claude Agent SDK）
- **记忆**：语义向量搜索（Moonshot embeddings）+ 关键词降级

---

## 🤝 参与贡献

我们欢迎社区贡献！Jowork 为社区而生。

```bash
git clone https://github.com/fluxvita/jowork
cd jowork
npm install
npm run dev       # 启动热重载开发服务器
npm test          # 运行测试套件（116 个用例）
npm run lint      # TypeScript + ESLint 检查
```

贡献前请：
1. 阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)
2. 签署 [贡献者许可协议（CLA）](https://cla-assistant.io/fluxvita/jowork)（通过 GitHub 一次性签署）
3. 查看 [open issues](https://github.com/fluxvita/jowork/issues)——找标有 `good first issue` 的任务

**开发连接器？** → [Jowork Connect Protocol 文档](https://docs.jowork.work/jcp)
**开发 Skill？** → [Skills API 文档](https://docs.jowork.work/skills)
**讨论路线图？** → [GitHub Discussions](https://github.com/fluxvita/jowork/discussions)

---

## 📄 许可证

- **核心代码**（`packages/core`、`apps/jowork`）：[AGPL-3.0](./LICENSE)
- **高级功能**（`packages/premium`）：[商业许可证](./LICENSE-PREMIUM)
- **连接器**（`packages/connector-*`）：MIT

AGPL-3.0 意味着：你可以免费使用、修改和分发 Jowork（包括商业用途）——前提是以相同许可证开源你的修改。如需私有许可证，[联系我们](mailto:hello@jowork.work)。

### AGPL-3.0 常见问题

<details>
<summary><strong>我在公司内部使用 Jowork，需要开源任何东西吗？</strong></summary>

不需要。仅供内部员工使用 Jowork **不要求**你公开源代码。AGPL 的网络使用条款仅在你通过网络向外部用户提供该软件时才适用。
</details>

<details>
<summary><strong>我修改了 Jowork Core 并作为 SaaS 提供给客户，需要做什么？</strong></summary>

根据 AGPL-3.0，你必须向这些客户提供你修改后的源代码（例如指向公开仓库的链接）。你无需公开你的私有数据或配置——只需公开修改过的 Jowork 源代码。
</details>

<details>
<summary><strong>我可以在 Jowork 之上构建私有产品吗？</strong></summary>

如果你只调用 Jowork 的 HTTP API（不修改或分发其源代码），你的应用**不受** AGPL 约束。如果你修改或打包了 Jowork Core，AGPL 适用于该 Core 部分。如需保持修改私有，请联系我们获取[商业许可证](mailto:hello@jowork.work)。
</details>

<details>
<summary><strong>我是贡献者，需要签署 CLA 吗？</strong></summary>

是的。我们使用[贡献者许可协议](https://cla-assistant.io/fluxvita/jowork)以便对贡献进行双重许可（AGPL + 商业）。CLA 通过 GitHub 一次性签署，不限制你对自己贡献的使用。
</details>

完整法律文件：[服务条款](./docs/legal/terms-of-service.md) · [隐私政策](./docs/legal/privacy-policy.md) · [退款政策](./docs/legal/refund-policy.md)

---

<div align="center">

由 [FluxVita](https://fluxvita.com) 用 ❤️ 构建 · [官网](https://jowork.work) · [Twitter](https://twitter.com/jowork_ai) · [Discord](https://discord.gg/jowork)

</div>
