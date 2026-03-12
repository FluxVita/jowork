# JoWork v2 — Master Implementation Plan

> **状态**: 未开始
> **创建日期**: 2026-03-13
> **目标**: 从零构建 JoWork v2，Electron + React 桌面应用 + 云服务

---

## 新旧项目关系

### 旧项目（归档）

| 属性 | 值 |
|------|------|
| 路径 | `/Users/signalz/Documents/augment-projects/jowork-v1-archived` |
| 仓库 | GitLab `Aiden/allinone` + GitHub `FluxVita/jowork` |
| 技术栈 | Tauri (Rust) + Express 5 + 原生 JS SPA + SQLite |
| 产品 | FluxVita（闭源）+ JoWork（开源），双品牌 |
| 架构 | Gateway 服务端（Mac mini 部署）+ 轻客户端 |
| 代码量 | ~33K 行 TypeScript + ~5K 行 HTML/CSS + ~500 行 Rust |

### 新项目（本项目）

| 属性 | 值 |
|------|------|
| 路径 | `/Users/signalz/Documents/augment-projects/jowork` |
| 仓库 | 新建 GitHub `FluxVita/jowork`（旧 repo 归档） |
| 技术栈 | Electron + React + TypeScript + SQLite (Drizzle) |
| 产品 | 统一为 JoWork（开源 AGPL-3.0） |
| 架构 | 本地优先桌面应用 + 可选云服务 |

### 关键变化

| 维度 | 旧 (v1) | 新 (v2) | 原因 |
|------|---------|---------|------|
| 桌面框架 | Tauri (Rust) | Electron | JS 全栈，AI 写代码效率更高 |
| 前端 | 原生 JS + Vue CDN | React + TypeScript | 组件化、类型安全、生态更好 |
| AI 引擎 | 内置 agent loop | 外挂 Claude Code / OpenClaw | 不重复造轮子，复用最强引擎 |
| 数据连接 | 自研 Connector | 复用社区 MCP Server + 管理层 | 20 个数据源不可能全部自研 |
| 部署模式 | Gateway 服务端 | 本地优先 + 可选云 | 去中心化，Personal 模式零成本 |
| 品牌 | FluxVita + JoWork 双品牌 | 统一 JoWork | 简化，开源单品牌 |
| 认证 | 必须登录 | Personal 无需登录 | 降低使用门槛 |
| 付费 | Stripe 订阅 | 本地永久免费 + 云积分/订阅 | 自带本地引擎可完全免费；也可一键使用 JoWork 托管 API 并直接购买积分 |

### 代码参考关系（不复用，仅参考）

旧项目代码**不直接复制**到新项目。以下文件作为设计参考：

| 旧文件 | 参考价值 | 用于 Phase |
|--------|---------|-----------|
| `packages/core/src/connectors/base.ts` | Connector 接口设计、AES 缓存、TTL 策略 | Phase 2 |
| `packages/core/src/connectors/protocol.ts` | discover/fetch/health 三方法协议 | Phase 2 |
| `packages/core/src/agent/controller.ts` | Agent loop、事件流设计 | Phase 1 |
| `packages/core/src/agent/tools/` | 15+ 工具定义、input_schema 格式 | Phase 2-3 |
| `packages/core/src/agent/session.ts` | Session 持久化、消息存储 | Phase 1 |
| `packages/core/src/agent/mcp-bridge.ts` | MCP 客户端生命周期管理 | Phase 2 |
| `packages/core/src/datamap/db.ts` | 28+ 表 SQLite schema、FTS 全文索引 | Phase 0-2 |
| `packages/core/src/memory/user-memory.ts` | 记忆 CRUD、标签搜索、语义检索 | Phase 3 |
| `packages/core/src/context/docs.ts` | 三层上下文组装、token 预算 | Phase 3 |
| `packages/core/src/scheduler/executor.ts` | Cron 任务分发、并行 connector discovery | Phase 5 |
| `packages/core/src/channels/feishu.ts` | 飞书 Bot 消息发送 | Phase 5 |
| `packages/core/src/billing/` | Stripe Checkout/Portal/Webhook/积分 | Phase 6 |
| `packages/core/src/policy/engine.ts` | RBAC + ABAC 检查 | Phase 6 |
| `packages/mcp-server/` | MCP Server 暴露工具、HTTP 代理 | Phase 2 |
| `apps/jowork/src-tauri/src/lib.rs` | Claude Code CLI spawn、PTY、OAuth 流程 | Phase 1, 4 |
| `apps/jowork/public/styles/tokens.css` | 设计 Token、暗色/亮色主题 | Phase 0 |
| `apps/jowork/public/shell.html` | 侧边栏 + 主区域布局参考 | Phase 0 |
| `packages/core/src/skills/` | Skill 加载、执行、类型定义 | Phase 3 |

### 从旧项目保留的设计模式

1. **Pluggable Engine Dispatcher** — 引擎通过统一接口切换，新增引擎只需实现适配器
2. **Connector Protocol** — discover/fetch/health 三方法 + 增量同步 cursor
3. **Tool Registry** — 动态工具发现 + 命名空间（MCP + Skills 统一注册）
4. **Session Persistence** — 对话历史存 DB + 成本追踪
5. **Event Stream Types** — 类型化 SSE 事件序列（session_created → thinking → tool_call → ...）
6. **Context PEP** — 基于权限过滤上下文中的敏感数据
7. **Memory System** — 标签 + 全文 + 语义搜索三层召回

### 从旧项目改进的设计

1. **模块化** — 旧版 `packages/core` 33K LOC 单包 → 新版按领域拆分
2. **前端架构** — 原生 JS → React 组件化 + Zustand 状态管理
3. **数据库** — 手写 SQL → Drizzle ORM + 类型安全迁移
4. **Connector** — 全部自研 → 复用社区 MCP Server + 统一管理层
5. **AI 引擎** — 内置 agent loop → 外挂 CLI subprocess
6. **凭据存储** — JWT secret 加密 → Electron safeStorage（系统钥匙串）

---

## 技术栈决策（已确认）

详见 [plans/tech-decisions.md](plans/tech-decisions.md)

## 实施阶段

| Phase | 名称 | 复杂度 | 计划文件 |
|-------|------|--------|---------|
| 0 | 项目骨架 | L | [phase-0-skeleton.md](plans/phase-0-skeleton.md) |
| 1 | 引擎 + 核心对话 | XL | [phase-1-engine-conversation.md](plans/phase-1-engine-conversation.md) |
| 2 | Connector + MCP | L | [phase-2-connector-mcp.md](plans/phase-2-connector-mcp.md) |
| 3 | 记忆 + 上下文 + Skills | L | [phase-3-memory-skills.md](plans/phase-3-memory-skills.md) |
| 4 | 桌面深度集成 | L | [phase-4-desktop-integration.md](plans/phase-4-desktop-integration.md) |
| 5 | 定时任务 + 远程通道 | M | [phase-5-scheduler-channels.md](plans/phase-5-scheduler-channels.md) |
| 6 | 认证 + 计费 + 团队 | L | [phase-6-auth-billing-team.md](plans/phase-6-auth-billing-team.md) |
| 7 | 同步 + i18n + 更新 | M | [phase-7-sync-i18n-update.md](plans/phase-7-sync-i18n-update.md) |
| 8 | Onboarding + 打磨 | S | [phase-8-onboarding-polish.md](plans/phase-8-onboarding-polish.md) |

## 关键路径

```
Phase 0 → Phase 1 → Phase 2 ──→ Phase 3
                 │        │            │
                 ├──→ Phase 4          │
                 │                     │
                 └──→ Phase 5 ◀────────┘
                      (含 Cloud Skeleton)
                          │
                     Phase 6 → Phase 7 → Phase 8
                  (Cloud Engine 首次可用)
```

Phase 2/3/4 可并行开发（Track A/B/C）。

**重要时序约束**:
- **Cloud Engine（云代理 AI）**: 要到 Phase 6 完成后才可用。Phase 1-5 阶段仅支持本地引擎。
- **Cloud Service 骨架**: 在 Phase 5 开头创建（Hono + PostgreSQL + Dockerfile），Phase 6/7 在此基础上扩展。
- **MCP Server 分发**: Phase 2 构建 JoWork MCP Server 的 CLI entry point，Phase 1 不注入（因为 server 还不存在）。

---

## 已知设计决策

| 决策 | 选择 | 备注 |
|------|------|------|
| 品牌色 | Indigo (#4f46e5) | 旧项目用 Lime (#9DD84A)，v2 改为 Indigo，更专业 |
| Electron Router | HashRouter / MemoryRouter | `file://` 不支持 HTML5 history API |
| Preload sandbox | `sandbox: false` | 已知安全退让，preload 需要 Node API；后续可优化为全 IPC |
| Cloud Engine 可用时机 | Phase 6+ | Phase 1-5 只支持本地引擎（Claude Code / OpenClaw） |
| DB Schema 分离 | SQLite (本地) + PostgreSQL (云端) | 共享类型定义，各自 schema 文件 |
| 免费边界 | Local-first 永久免费 | 本地引擎 / 本地 Connector / 本地记忆 / 本地 Skills 不收费 |
| 云能力计费 | 积分钱包 + Pro/Team 订阅 | 登录后可直接使用 JoWork 托管 API，也可单独充值积分 |
| Connector 首发集合 | 5 个核心 connector / 6 项关键能力 | GitHub、GitLab、Figma、Feishu（群消息+文档）、本地项目文件夹 |
| Team 数据主从 | 云端为准，本地缓存 | Team 数据云端主库；Personal 数据本地为准，可选同步 |
