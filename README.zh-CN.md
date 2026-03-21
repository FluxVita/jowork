# JoWork

**AI 编程 Agent 缺失的 GUI。**

[English](./README.md)

Claude Code、Codex、OpenClaw 这些 CLI Agent 很强大——但管理多个对话窗口、拖文件夹进上下文、监控数据源状态？在纯终端里非常痛苦。

JoWork 解决这个问题。它是终端旁边的**伴侣面板**——不替代终端，只补终端做不好的事。

```
┌─ 你的终端 ───────────────┐ ┌─ JoWork Dashboard ──────────────┐
│                          │ │ 数据源                            │
│  $ claude                │ │ ● 飞书  583 条消息  2分钟前同步    │
│  > 团队这周讨论了什么？    │ │ ● GitHub  30 个 PR  5分钟前同步   │
│                          │ │                                   │
│  Agent: 根据飞书消息，    │ │ 会话  上下文  目标                 │
│  有 3 个主要话题：...     │ │ ┌─────────────────────────────┐  │
│                          │ │ │ 📁 ~/project/src            │  │
│                          │ │ │ 📊 飞书：产品讨论群           │  │
│                          │ │ │ ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐ │  │
│                          │ │ │ │  拖入文件夹即可索引      │ │  │
│                          │ │ │ └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘ │  │
└──────────────────────────┘ └─────────────────────────────────┘
```

## 为什么需要 JoWork？

Vibe coder 和非技术用户每天都在用 AI Agent 创造。但终端体验有真实的缺口：

| 你想要的 | 终端给你的 |
|---------|----------|
| 像浏览器标签一样切换多个 Agent 对话 | `tmux`（得先学会它） |
| 拖个文件夹进对话当上下文 | 手动一个个粘贴文件路径 |
| 看到哪些数据源连着、同步状态如何 | 每次都跑 `jowork status` |
| 把特定目录 + 数据源一起加载到对话里 | 手动输入 MCP 工具调用 |

**JoWork = 填补这些缺口的伴侣面板。** 不重新造终端和聊天，只做终端做不好的事——拖拽、可视化、多窗口管理。

---

## 快速开始

```bash
# 安装
npm install -g jowork

# 初始化 + 注册 Agent
jowork init
jowork register claude-code    # 或: codex, openclaw

# 完成。Claude Code 现在有跨 session 记忆了。

# 连接数据源（可选）
jowork connect feishu          # 交互式认证
jowork connect github          # 使用环境变量 GITHUB_PERSONAL_ACCESS_TOKEN

# 同步 + 搜索
jowork sync
jowork search "产品发布"

# 打开伴侣面板
jowork dashboard
```

---

## 具体场景

### 1. "我想在一个地方看到所有 Agent 会话"

你有一个终端 tab 里 Claude Code 在做前端重构，另一个 tab 里 Codex 在分析数据，还有 OpenClaw 在写 API。切换它们意味着不停 alt-tab 找窗口。

**用 JoWork Dashboard：**
- 浏览器打开 `jowork dashboard`
- 看到所有活跃的 Agent 会话——项目名、引擎类型、持续时间
- 点击 "Focus" 直接跳到对应终端窗口，或复制命令
- Agent 连接/断开时会话实时出现/消失

### 2. "我想把一个文件夹拖进对话"

你在用 Claude Code，需要它理解你的 `src/components/` 目录。现在你得手动描述文件或一个个粘贴路径。

**用 JoWork Dashboard：**
- 打开 Context 标签页
- 把 `~/project/src/components/` 拖进 drop zone
- JoWork 立即索引所有文件（自动跳过 `node_modules`、`.git`、二进制文件）
- 你的 Agent 现在能通过 `search_data` 搜索到那个文件夹里的任何文件
- 文件夹自动出现在 Agent 的环境上下文里

### 3. "告诉我数据源的健康状态"

你连接了飞书、GitHub 和 PostHog。它们在同步吗？上次同步是什么时候？索引了多少数据？

**用 JoWork Dashboard：**
- 侧边栏始终显示连接状态：🟢 已连接 / 🔴 未连接
- 一眼看到数据量（583 条消息、30 个 PR）
- 上次同步时间（"2分钟前"、"5分钟前"）
- 一键 "Sync Now" 按钮

### 4. "我想让 Agent 知道我的目标"

设定目标如"6月上线、DAU 破万"，JoWork 自动监控——追踪 PostHog、GitHub milestone 等数据源的信号。

```bash
jowork goal add "产品 6 月上线，DAU 破万"
jowork signal add <goal_id> --source posthog --metric dau --direction maximize
jowork measure add <signal_id> --threshold 10000 --type gte
```

Goals 标签页展示进度条、信号值和达标/未达标状态。你的 Agent 也能看到这些目标，并在指标变化时主动告诉你。

---

## 功能

### 伴侣面板（`jowork dashboard`）

运行在终端旁边的 localhost Web UI：

- **侧边栏：** 数据源状态（实时绿/红点、数据量、同步时间）
- **会话标签：** 活跃 Agent 会话（引擎类型、PID、持续时间、聚焦按钮）
- **上下文标签：** 活跃上下文条目 + 拖拽文件索引
- **目标标签：** 目标进度（信号值、度量状态）
- **实时更新：** WebSocket 推送，无需手动刷新
- **深色/浅色模式：** 工业极简设计 + 琥珀色强调色
- **响应式：** 窄屏时侧边栏折叠（适合半屏伴侣使用）
- **安全：** CSRF token 保护 + 仅 localhost 绑定

### 数据源

| 数据源 | 同步内容 | 状态 |
|--------|---------|------|
| 飞书 | 消息、日历事件、知识库文档、审批 | 可用 |
| GitHub | 仓库、Issue、Pull Request | 可用 |
| GitLab | 项目、Issue、Merge Request | 可用 |
| Linear | Issue (GraphQL) | 可用 |
| PostHog | 洞察、事件定义、指标 | 可用 |

### MCP 工具（15 个）

Agent 通过 [MCP 协议](https://modelcontextprotocol.io/)自动调用：

| 工具 | 功能 |
|------|------|
| `search_data` | 跨所有已同步数据的全文搜索 |
| `read_memory` / `write_memory` | 跨 session 记忆（自动截断） |
| `search_memory` | 时间加权记忆搜索（近期优先） |
| `get_goals` / `get_metrics` | 目标进度和信号值 |
| `get_hot_context` | 近期活动摘要（24-72h） |
| `get_briefing` | 每日简报：活动 + 目标 + 数据新鲜度 |
| `push_to_channel` | 发消息到飞书（Slack/Telegram 计划中） |
| `update_goal` | 修改目标（copilot 模式需人工审批） |
| `get_environment` | 系统信息 + 活跃上下文 |

### 跨数据源关联

JoWork 自动关联不同数据源的相关数据——零 LLM 成本：

- 飞书消息里的 `PR#123` → 自动关联到 GitHub PR
- `LIN-456` → 关联到 Linear Issue
- `@提及` → 关联到对应人员
- 时间关联：不同数据源中 2 小时内创建的内容自动关联

### 多层记忆

| 层级 | 内容 | 访问方式 |
|------|------|---------|
| L1 热层 | 最近 24-72h 摘要 | `get_hot_context()` |
| L2 温层 | 按目标的周级趋势 | `get_briefing()` |
| L3 冷层 | 全量原始数据 | `search_data()` |

Agent 默认获取 L1-L2 摘要（省 token）。需要深入时查询 L3。

---

## 工作原理

```
你的 AI Agent（Claude Code, Codex, OpenClaw）
        │
        │  MCP 协议 (stdio)
        ▼
┌───────────────────────────────────────────────────┐
│  JoWork CLI                                        │
│                                                    │
│  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ MCP Server   │  │ 目标系统                    │  │
│  │ 15 个工具    │  │ Goal → Signal → Measure    │  │
│  │ 4 个资源     │  │                            │  │
│  └──────┬───────┘  └───────────┬────────────────┘  │
│         │                      │                    │
│  ┌──────▼──────────────────────▼────────────────┐  │
│  │ 多层记忆 + 跨源关联引擎                        │  │
│  │ L1 热层 ← 压缩 ← L3 冷层 ← 同步               │  │
│  └──────────────────────┬───────────────────────┘  │
│                         │                           │
│  ┌──────────────────────▼───────────────────────┐  │
│  │ 数据连接器                                     │  │
│  │ 飞书 │ GitHub │ GitLab │ Linear │ PostHog     │  │
│  └──────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
        │
        ▼
   本地 SQLite（WAL 模式，FTS5，数据全在你的机器上）
```

Dashboard 是独立进程，与其他组件共享同一个 SQLite 数据库：

```
浏览器 (localhost:18801)  ←→  Dashboard 服务器 (Hono + WebSocket)
                                      │
                                  SQLite DB  ←  后台 Daemon（每 15 分钟同步）
                                      │
                                  MCP Server  ←  你的 Agent
```

---

## 数据隐私

所有数据保存在你的本地机器上。JoWork 使用本地 SQLite（WAL 模式）。无云端、无遥测、无第三方服务——除了你主动连接的 API。

## 系统要求

- Node.js >= 20
- macOS 或 Linux（Windows：欢迎社区贡献）

## 路线图

- [ ] Tauri 桌面应用封装（系统级拖拽集成）
- [ ] 更多数据源：Slack、Notion、Jira、Firebase
- [ ] 团队协作（共享目标、多用户同步）
- [ ] 云端同步（多设备）

## 开源协议

[AGPL-3.0](LICENSE) — 个人使用免费。商业嵌入需要许可证。

## 链接

- 官网：[jowork.work](https://jowork.work)
- 问题反馈：[GitHub Issues](https://github.com/FluxVita/jowork/issues)
