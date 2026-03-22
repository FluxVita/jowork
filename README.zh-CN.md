<p align="center">
  <h1 align="center">JoWork</h1>
  <p align="center"><strong>AI 编程 Agent 缺失的 GUI。</strong></p>
  <p align="center">
    管理多个 Agent 会话、拖文件夹进上下文、监控数据源——全在终端旁边的伴侣面板里。
  </p>
  <p align="center">
    <a href="https://www.npmjs.com/package/jowork"><img src="https://img.shields.io/npm/v/jowork?style=flat-square&color=E8B931" alt="npm version"></a>
    <a href="https://github.com/FluxVita/jowork/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square" alt="License"></a>
    <a href="https://jowork.work"><img src="https://img.shields.io/badge/docs-jowork.work-black?style=flat-square" alt="Docs"></a>
  </p>
  <p align="center">
    <a href="./README.md">English</a>
    <span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
    <a href="https://jowork.work">官网</a>
    <span>&nbsp;&nbsp;·&nbsp;&nbsp;</span>
    <a href="https://github.com/FluxVita/jowork/issues">问题反馈</a>
  </p>
</p>

<br>

```
┌─ 你的终端 ───────────────┐  ┌─ JoWork Dashboard ──────────────┐
│                          │  │ 数据源                            │
│  $ claude                │  │ ● 飞书  583 条消息  2分钟前同步    │
│  > 团队这周讨论了什么？    │  │ ● GitHub  30 个 PR  5分钟前同步   │
│                          │  │                                   │
│  Agent: 根据飞书消息，    │  │ 会话  上下文  目标                 │
│  有 3 个主要话题：...     │  │ ┌─────────────────────────────┐  │
│                          │  │ │ 📁 ~/project/src            │  │
│                          │  │ │ 📊 飞书：产品讨论群           │  │
│                          │  │ │                             │  │
│                          │  │ │  [ 拖入文件夹即可索引 ]      │  │
│                          │  │ └─────────────────────────────┘  │
└──────────────────────────┘  └─────────────────────────────────┘
```

<br>

## 为什么需要 JoWork？

Vibe coder 和非技术用户每天都在用 AI Agent 创造。但终端体验有真实的缺口：

| 你想要的 | 终端给你的 |
|---------|----------|
| 像浏览器标签一样切换多个 Agent 对话 | `tmux`（得先学会它） |
| 拖个文件夹进对话当上下文 | 手动一个个粘贴文件路径 |
| 看到哪些数据源连着、同步状态如何 | 每次都跑 `jowork status` |
| 把特定目录 + 数据源一起加载到对话里 | 手动输入 MCP 工具调用 |

**JoWork = 填补这些缺口的伴侣面板。** 不做 chat、不做终端模拟——只做终端做不好的事。

<br>

## 快速开始

```bash
npm install -g jowork
jowork init && jowork register claude-code
```

完成。你的 Agent 现在有跨 session 记忆了。无服务器、无云端。

```bash
# 连接数据源
jowork connect feishu          # 交互式认证
jowork connect github          # 使用环境变量 GITHUB_PERSONAL_ACCESS_TOKEN

# 同步 + 搜索
jowork sync
jowork search "产品发布"

# 打开伴侣面板
jowork dashboard
```

> [!TIP]
> 也支持 Codex 和 OpenClaw：`jowork register codex` 或 `jowork register openclaw`

<br>

## 具体场景

### 场景 1 — "我有 3 个 Agent 在跑，哪个在做什么？"

Claude Code 在重构前端，Codex 在分析数据，OpenClaw 在写 API。切换它们意味着不停 alt-tab 找窗口。

**用 JoWork：** 打开 `jowork dashboard` → 看到所有活跃会话的项目名、引擎类型、持续时间 → 点击 "Focus" 直接跳到对应终端窗口。

### 场景 2 — "我要 Agent 理解这个文件夹"

你需要 Claude Code 理解 `src/components/` 目录。现在得手动描述文件。

**用 JoWork：** 打开 Context 标签 → 把 `~/project/src/` 拖进 drop zone → JoWork 立即索引所有文件（自动跳过 `node_modules`、`.git`、二进制文件）→ Agent 可以搜索和引用每个文件。

### 场景 3 — "数据源健康吗？"

你连了飞书、GitHub 和 Linear。它们在同步吗？

**用 JoWork：** 侧边栏实时显示连接状态（🟢/🔴）、数据量和上次同步时间。需要最新数据时一键 "Sync Now"。

### 场景 4 — "追踪产品上线目标"

```bash
jowork goal add "产品 6 月上线，DAU 破万"
jowork signal add <goal_id> --source posthog --metric dau --direction maximize
jowork measure add <signal_id> --threshold 10000 --type gte
```

Goals 标签展示进度条和信号值。Agent 也能看到这些目标，指标变化时主动告诉你。

<br>

## 数据同步架构

JoWork 将数据存储为**本地文件** — 消息和文档用 markdown，分析数据用 JSON。像代码仓库一样，由 git 管理版本。

```
~/.jowork/data/repo/
├── feishu/messages/资料分享/2026-03-21.md   ← 按天的群消息
├── github/FluxVita-jowork/issues/42.md     ← issue（含 YAML 元数据）
├── posthog/insights/DAU-趋势.json          ← 分析数据（JSON）
└── .git/                                    ← 版本控制
```

### 同步模式
- **拉取**: `jowork sync` — 从所有数据源获取最新数据
- **推送**: `jowork push` — 将本地编辑推送回 GitHub/GitLab/Linear
- **自动**: `jowork serve --daemon` — 每 15 分钟自动同步（可按数据源配置）

### 双向同步
| 数据源 | 拉取 | 推送 | 可推送内容 |
|--------|------|------|-----------|
| GitHub/GitLab | ✅ | ✅ | Issue 标题、描述、状态、标签 |
| Linear | ✅ | ✅ | Issue 标题 |
| 飞书消息 | ✅ | ❌ | 只读（可通过 push_to_channel 发新消息） |
| PostHog/Sentry | ✅ | ❌ | 分析数据只读 |

### 配置同步频率
```bash
jowork config set syncIntervalMinutes 10                    # 所有数据源
jowork config set syncIntervals '{"feishu":5,"github":30}'  # 按数据源配置
```

<br>

## 功能

### 伴侣面板

运行在终端旁边的 localhost Web UI（`jowork dashboard`）：

- **侧边栏** — 数据源状态（实时圆点、数据量、同步时间）
- **会话** — 活跃 Agent 会话（引擎类型、聚焦按钮、持续时间）
- **上下文** — 拖拽文件索引 + 活跃上下文条目
- **目标** — 目标进度（信号值、度量状态）
- **实时** — WebSocket 推送，无需刷新
- **深色/浅色** — 工业极简设计，琥珀色强调色
- **响应式** — 半屏宽度可用，适合伴侣使用
- **安全** — CSRF 保护 + 仅 localhost 绑定

### 数据源

| 数据源 | 同步内容 |
|--------|---------|
| GitHub | 仓库、Issue、Pull Request |
| GitLab | 项目、Issue、Merge Request |
| Linear | Issue (GraphQL) |
| PostHog | 洞察、事件定义、指标 |
| 飞书 | 消息、日历、知识库文档、审批 |
| Slack | 频道消息 *（计划中）* |

### MCP 工具

Agent 通过 [MCP 协议](https://modelcontextprotocol.io/)自动调用：

- **`search_data`** — 跨所有数据源全文搜索
- **`read_memory` / `write_memory`** — 跨 session 记忆（自动截断）
- **`search_memory`** — 时间加权搜索（近期优先）
- **`get_goals` / `get_metrics`** — 目标进度和信号值
- **`get_hot_context`** — 近期活动摘要（24-72h）
- **`get_briefing`** — 每日简报
- **`push_to_channel`** — 发消息到已连接的频道
- **`get_environment`** — 系统信息 + 活跃上下文

### 跨数据源关联

自动关联不同数据源的相关数据——零 LLM 成本：

- 飞书消息里的 `PR#123` → 自动关联到 GitHub PR
- `LIN-456` → 关联到 Linear Issue
- `@提及` → 关联到对应人员
- 时间关联 — 不同数据源中 2 小时内创建的内容自动关联

### 多层记忆

| 层级 | 内容 | 使用场景 |
|------|------|---------|
| L1 热层 | 最近 24-72h 摘要 | "今天发生了什么？" |
| L2 温层 | 按目标的周级趋势 | "上线进展如何？" |
| L3 冷层 | 全量原始数据 | "找上个月那个 PR 讨论" |

Agent 默认获取 L1-L2（省 token）。需要深入时查询 L3。

<br>

## CLI 命令参考

<details>
<summary><strong>完整命令列表</strong></summary>

```bash
# 初始化
jowork init                        # 创建本地数据库
jowork register <engine>           # claude-code | codex | openclaw
jowork connect <source>            # github | gitlab | linear | posthog | feishu
jowork doctor                      # 诊断检查

# 日常使用
jowork dashboard                   # 在浏览器中打开伴侣面板
jowork sync [--source <s>]         # 从已连接的数据源同步
jowork search <query>              # 全文搜索
jowork status                      # 系统概览
jowork log                         # 查看同步历史
jowork push                        # 将本地修改推送回数据源
jowork serve --daemon              # 后台同步 + 信号轮询

# 配置
jowork config get <key>            # 获取配置值
jowork config set <key> <value>    # 设置配置值
jowork config list                 # 显示所有配置

# 目标
jowork goal add|list|status        # 目标管理
jowork signal add <goal_id>        # 为目标绑定信号
jowork measure add <signal_id>     # 设置信号阈值

# 维护
jowork export [--format json]      # 备份数据库
jowork gc [--retention-days N]     # 清理 + vacuum
jowork device-sync export|import   # 跨设备同步
jowork install-service             # 生成 LaunchAgent / systemd
```

</details>

<br>

## 数据隐私

所有数据保存在本地。SQLite，无云端，无遥测。唯一的网络请求是你主动连接的 API。

## 系统要求

Node.js >= 20 · macOS 或 Linux · 欢迎 Windows 贡献

## 路线图

- [ ] Tauri 桌面应用封装（系统级拖拽）
- [ ] Slack 和 Notion 连接器
- [ ] 团队协作（共享目标）
- [ ] 多设备云端同步

## 开源协议

[AGPL-3.0](LICENSE) — 个人使用免费。商业嵌入需要许可证。
