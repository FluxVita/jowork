# JoWork v3 — CLI 重构实施计划

> **状态**: APPROVED (office-hours 2026-03-20) → CEO Review SELECTIVE EXPANSION (2026-03-20) → 竞品分析 + 战略修正 (2026-03-20)
> **日期**: 2026-03-20
> **目标**: 从 Electron 桌面应用转型为 CLI-first Agent Infrastructure
> **Design Doc**: `~/.gstack/projects/jowork/signalz-main-design-20260320-office-hours.md`
> **CEO Plan**: `~/.gstack/projects/jowork/ceo-plans/2026-03-20-cli-pivot.md`

---

## 〇、Problem Statement

AI Agent 引擎（Claude Code, Codex, OpenClaw）是强大的推理器，但对组织上下文完全盲目。它们能执行指令，但无法主动理解公司数据源中正在发生什么——飞书消息、会议、GitHub PR、产品指标、项目管理。每次对话都从零开始。

**JoWork v3 = AI Agent 的能力 + 数据基建**

不只是数据层，还包括目标系统、主动推送、跨源链路。让 Agent 从"被动回答问题"变成"主动理解你的工作并帮你干活"的完整基础设施。

### 5 个核心场景

| # | 场景 | JoWork 提供的能力 |
|---|------|-----------------|
| 1 | 用户问"上周留存怎么样"→ Agent 分析行为数据 → 定位代码 bug → 修复 | **跨数据源链路**：PostHog → 分析 → GitHub → 代码修复 |
| 2 | Agent 7×24 陪用户工作：参加会议、看文档、读群消息 | **持续数据同步**：飞书全量 + 实时事件 |
| 3 | Agent 主动告诉用户：留存下降了、今天待办有 5 项、发现 3 个潜在 bug | **主动洞察 + 推送**：Signal Poller + Channel Push |
| 4 | Agent 有自己的 OKR，基于目标自主思考、获取数据、给建议、主动沟通 | **Goal-Signal-Measure**：Agent 行动指令系统 |
| 5 | 不懂代码的用户也能连接各种数据源 | **友好的数据源配置**：CLI 交互式 + 未来可视化管理 |

### 定位语言

- **主标语**：JoWork — 让 AI Agent 真正理解你的工作
- **副标语**：连接数据源，给 Agent 感知能力和行动目标。本地优先，一条命令。
- **技术标签**：Agent Infrastructure（避开拥挤的 "MCP server" 赛道）

### 产品本质

JoWork **不是** APP，**不是**记忆系统，**不是** MCP server。

**JoWork 是 Agent 的感知层 + 行动层** — 让 AI Agent 从"聊天工具"变成"自主助手"的中间层。

没有 JoWork 的 Agent = 关在黑屋里的天才大脑，你说什么它回什么，但它看不见你的世界。
有 JoWork 的 Agent = 这个大脑有了：
- **眼睛**（Data Connectors — 能看到飞书、GitHub、PostHog 里发生了什么）
- **记忆**（Memory — 记得上次聊了什么、你的偏好、项目进展）
- **目的**（Goal System — 知道该关注什么、什么时候该主动行动）
- **嘴巴**（Channel Push — 能主动找你说"留存掉了"）

### 双界面设计（开发者 + 非开发者）

产品有两个界面，服务两类用户：

1. **CLI** — 给工程师，setup + admin + 高级操作
2. **MCP** — 给所有人，通过 AI Agent 自然语言交互

**非开发者使用路径**：工程师跑一次 `jowork init && jowork connect feishu`，之后 CEO/PM 只需要跟自己的 AI Agent 对话：

```
PM: "上周留存怎么样？"
Agent: (通过 MCP 调 search_data → PostHog 数据) "DAU 下降 8%，定位到..."

CEO: "帮我关注 crash rate，超过 1% 就告诉我"
Agent: (通过 MCP 调 update_goal 自动创建 Goal + Signal)

CEO: "最近飞书里大家在讨论什么？"
Agent: (通过 MCP 调 get_hot_context) "3 个主要话题：..."
```

**关键推论**：MCP 工具的描述质量 = 非开发者的 UX 质量。tool description 写得好，Agent 就能自然地调用，用户完全不需要知道底层有 JoWork。

后续可加 `jowork dashboard`（localhost web UI）做监控面板，但不是核心 — 对话就是界面。

---

## 〇.一、商业化路径

### 第一阶段：免费开源拿用户（现在 → 6 个月）

AGPL 开源 + 完全免费，all-in 开发者采用。

**目标**：GitHub 1000+ stars，活跃用户社区。
**逻辑**：开源项目的 star 数 + 用户数对融资有直接帮助。这阶段不想钱，想 traction。

### 第二阶段：Team + Cloud 收费（6-12 个月）

| | Free（AGPL） | Pro（$30/user/月） | Enterprise |
|---|---|---|---|
| 单用户本地 | ✅ | ✅ | ✅ |
| 所有 connectors | ✅ | ✅ | ✅ |
| Memory + Goals | ✅ | ✅ | ✅ |
| **Team 协作**（共享 goals/数据） | ❌ | ✅ | ✅ |
| **Cloud sync**（多设备） | ❌ | ✅ | ✅ |
| **Managed compaction**（JoWork 替你调 LLM） | ❌ | ✅ | ✅ |
| Dashboard web UI | ❌ | ✅ | ✅ |
| SSO / 审计 / SLA | ❌ | ❌ | 定制 |

**收费逻辑**：单人免费，团队付费。Slack/Linear/GitLab 验证过的路径。

### 第三阶段：AGPL 商业许可（被动收入）

AGPL 的杀手锏：任何公司想把 JoWork 嵌入自己的闭源产品 → **必须开源自己的代码，或者买商业许可**。

这是 MongoDB、Elastic 的模式。AGPL 自动筛客户 — 用了就得付钱或开源。

### 商业化决策记录

| # | 决策 | 选择 | 拒绝方案 | 拒绝理由 | 重新采用条件 |
|---|------|------|---------|---------|-------------|
| B1 | 产品独立性 | JoWork 是完全独立的产品 | 作为其他产品的基建层 | JoWork 有自己的用户群和商业化路径，不依赖任何其他产品 | — |
| B2 | 收费模式 | Open Core（单人免费 + 团队付费） | 纯 SaaS / 纯开源 | Open Core 兼顾社区增长和商业收入 | — |
| B3 | 许可证 | AGPL-3.0 | MIT / Apache | AGPL 强制商业用户付费或开源，是商业化护城河 | — |
| B4 | 第一阶段重心 | Traction > Revenue | 先收费 | 0→1 阶段用户数和社区比收入更重要 | 有明确 PMF 信号后加速收费 |

---

## 〇.二、底层哲学

### 1. Goal-driven：目标是一切 context 的锚点

所有涌入的数据通过 Objective 这面棱镜折射。Agent 拿到的不是原始数据堆砌，而是"跟目标相关的、经过组织的 context"。

### 2. Context, not control（但兼备 control）

核心是为 Agent 提供 context，让 Agent 自主判断该做什么。同时保留 control 能力（创建任务、分配工作等），两者兼备，context 为主。

### 3. AI-native，不为人类限制设计

- **全量存储**所有数据（AI 不存在注意力瓶颈），靠多层记忆架构 + 渐进式信息披露实现智能检索
- 目标不限数量、不限层级、可动态演化
- KR 绑定可计算的数据信号，Agent 自动评估进展
- 传统 OKR 为人类设计（3-5 个目标、季度固定、人工 check-in）→ AI-native Goal System 需要重新设计

---

## 〇.二、核心架构原则（Eng Review + Codex 反馈）

**脚本同步，模型摘要**：数据获取靠 API 脚本增量同步（零 token），类似 GitHub/GitLab 的 git pull 机制。模型只在 Compaction（摘要生成）时消耗 token，且只处理增量数据。MCP 工具返回的是已同步到本地的数据（FTS 查询 <10ms），不是让模型实时去读大量 context。

**错误处理基线**：
- 所有 DB 操作必须设置 `busy_timeout`（5000ms），防止 daemon 和 MCP server 并发写入时 crash
- Sync 批量写入必须用短事务（每 100 条一个 txn），事务间释放写锁，让 MCP server 和 plugin 能在间隙写入
- 所有外部 API 调用必须 try-catch + 写入结构化错误日志（category + context + stack）
- FTS 查询必须转义用户输入（防 FTS 语法注入：AND, OR, NEAR, * 等操作符）
- 日志系统必须自动脱敏 token、secret、API key 等敏感字段（正则替换为 `***`）
- 参数化查询（Drizzle ORM），禁止手写 SQL 字符串拼接

**MCP 安全边界**：
- 所有查询类工具默认 `limit: 20`，最大 100
- `push_to_channel`：rate limit（每分钟 5 次）、target allowlist、audit log
- `update_goal`：copilot 模式需要 confirmation（返回 pending 状态，等人审批）
- 大结果集：返回摘要 + "用 fetch_content 获取详情" 的引导，不一次性灌入 context

---

## 〇.三、方案选型

在 office hours 中评估了三种实施路径：

| 方案 | 描述 | Effort | Completeness |
|------|------|--------|-------------|
| A: Minimal Viable | 只做 CLI + MCP，不做 connectors/sync/goals，一天内可用 | S | 3/10 |
| **B: 当前 Plan（选定）** | **6 Phase 完整路线图，干净提取、架构完整** | **L** | **9/10** |
| C: Data-First | 合并 Phase 1+2，最快让 Agent 拿到真实数据 | M | 7/10 |

**选择 B 的理由**：探索阶段仍需要干净的架构基础。Phase 1 的模块提取为后续所有 Phase 奠定基础，Goal-Signal-Measure 是核心差异化，需要稳固的地基。

**拒绝 A**：没有数据同步能力的 MCP server 价值为零。
**拒绝 C**：跳过干净提取会导致 desktop 残留代码混入 CLI，后续 Phase 每一步都要背债。

---

## 〇.四、竞品分析

### JoWork 独到优势（竞品没有的）

综合所有竞品分析，JoWork 的**不可复制的组合**：

```
  1. Local-first + Multi-source sync
     (Graphlit/Dust 做 sync 但 cloud-first)
     (OpenMemory/claude-mem 做 local 但无 multi-source sync)

  2. Goal-Signal-Measure (Agent 行动指令)
     (完全蓝海，无竞品)

  3. 跨数据源链路能力（场景 1）
     (PostHog → 行为分析 → 代码定位 → 修复)
     (没有竞品做到端到端跨源链路)

  4. 飞书深度集成
     (ChatClaw 有但功能浅；Hyperspell/Dust 完全没有)

  5. CLI-first + MCP（为 Agent 设计，不为人类设计）
     (Dust/Graphlit 为人类设计 SaaS 界面)
```

### 竞品差异化矩阵

| 能力 | JoWork | claude-mem | Supermemory | Hyperspell | Dust.tt |
|------|--------|-----------|-------------|-----------|---------|
| Local-first | ✅ | ✅ | ❌ cloud | ❌ cloud | ❌ cloud |
| 跨 session memory | ✅ | ✅ | ✅ | ✅ | ❌ |
| Multi-source sync | ✅ | ❌ | 部分 | ✅ | ✅ |
| 飞书深度集成 | ✅ | ❌ | ❌ | ❌ | ❌ |
| Goal-Signal-Measure | ✅ | ❌ | ❌ | ❌ | ❌ |
| 跨源链路（PostHog→代码） | ✅ | ❌ | ❌ | ❌ | ❌ |
| 主动推送 | ✅ | ❌ | ❌ | ❌ | 部分 |
| CLI-first + MCP | ✅ | ✅ | ❌ | ❌ SDK | ❌ Web |
| 免费开源 | ✅ AGPL | ✅ AGPL | ✅ MIT | ❌ | ❌ |

### 从 claude-mem 学什么（AGPL-3.0，可参考架构）

| 学什么 | 为什么 | 怎么用 |
|--------|--------|--------|
| **Lifecycle hooks** | 自动捕获 Agent session 的关键决策/context | JoWork daemon 监听 Agent 活动，自动提取 memory |
| **10x 压缩** | 1000-10000 token 压缩到 ~500 | Compaction 层复用压缩策略 |
| **Progressive disclosure** | compact index → timeline → full details | MCP 工具分层返回（摘要 → 详情 → 原文） |
| **零配置价值** | 装了就有用，不需要 connect 数据源 | Phase 1 的 memory 功能应该零配置可用 |
| **Web 可视化** | localhost:37777 查看 memory stream | `jowork dashboard` 未来可做 |

**注意**：claude-mem 是 AGPL-3.0，JoWork 也是 AGPL，可以直接复用代码。但 claude-mem 依赖 Bun + Claude Agent SDK，需要适配。

### 从 Supermemory 学什么（MIT，可直接移植）

| 学什么 | 为什么 | 怎么用 |
|--------|--------|--------|
| **6 阶段 processing pipeline** | Queued→Extract→Chunk→Embed→Index→Done | 数据同步后的处理流水线 |
| **Relationship modeling** | Updates/Extends/Derives 关系图 | 跨源关联 L2 的实现参考 |
| **Semantic chunking** | 按语义边界分块，不是固定大小 | 对象分块策略改进 |
| **Container tag isolation** | 多租户隐私边界 | 未来 team 模式的隔离设计 |
| **User profile generation** | 从 memory 聚合用户画像 | Agent 自动理解用户偏好 |

**MIT 许可证**：可以直接提取代码组件，无限制。

### ChatClaw 必须深入研究

唯一功能高度重叠 + 飞书支持的开源项目（Go，160 stars）。
需要研究：他们的飞书集成怎么做的、踩了哪些坑、用户反馈是什么。

### 竞品技术移植计划

**Phase 1 移植（零配置 memory）**：
- claude-mem: MCP tool 内置智能行为（替代 lifecycle hooks，适配 MCP 协议）
- claude-mem: 10x token 压缩策略
- claude-mem: progressive disclosure（compact → timeline → full）

**Phase 2（Goal System，原 Phase 3）移植**：
- Supermemory: 6 阶段 processing pipeline（集成到 sync engine）
- Supermemory: relationship modeling（Updates/Extends/Derives）

**Phase 3（多层记忆，原 Phase 5）移植**：
- Supermemory: semantic chunking（替代固定大小分块）
- Supermemory: container tag isolation（team 模式隔离）
- Supermemory: user profile generation（Agent 理解用户偏好）

---

## 一、核心设计

### 架构总览

```
┌─────────────────────────────────────────────────┐
│  Agent 引擎（用户自选，JoWork 不拥有）             │
│  OpenClaw │ Claude Code │ Codex │ 其他            │
└─────┬───────────┬──────────┬────────────────────┘
      │     MCP 协议         │
┌─────▼───────────▼──────────▼────────────────────┐
│  JoWork CLI（核心产品，npm install -g jowork）     │
│                                                   │
│  ┌──────────────┐  ┌───────────────────────────┐  │
│  │ MCP Server   │  │ Goal System               │  │
│  │ (Agent 接口) │  │ Goal → Signal → Measure   │  │
│  │              │  │ (AI-native, not OKR)       │  │
│  └──────┬───────┘  └───────────┬───────────────┘  │
│         │                      │                   │
│  ┌──────▼──────────────────────▼───────────────┐  │
│  │ Multi-layer Memory (全量存储 + 智能检索)      │  │
│  │ L0: Working (Agent 引擎管理)                 │  │
│  │ L1: Hot (24-72h 摘要)                        │  │
│  │ L2: Warm (按 Goal 组织的趋势/决策摘要)        │  │
│  │ L3: Cold (全量原始数据, FTS + 向量索引)       │  │
│  └──────────────────────┬──────────────────────┘  │
│                         │                          │
│  ┌──────────────────────▼──────────────────────┐  │
│  │ Data Connectors (数据同步引擎, API/脚本驱动)  │  │
│  │ 飞书(消息/会议/文档/日历/邮件) │ GitHub/GitLab │  │
│  │ PostHog/Firebase │ Linear │ 本地文件 │ 更多... │  │
│  └─────────────────────────────────────────────┘  │
│                                                    │
│  ┌─────────────────────────────────────────────┐  │
│  │ Cross-source Linker (跨数据源关联引擎)       │  │
│  │ L1: 标识符正则提取 + object_links            │  │
│  │ L2: Embedding 相似度 + 时间/参与人关联       │  │
│  │ L3: Temporal Knowledge Graph                 │  │
│  └─────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────┘
```

### 数据流

```
数据源 (飞书/GitHub/PostHog/...)
  → API/脚本同步（不消耗 token）
  → 全量写入 Cold Storage (L3)
  → Cross-source Linker 提取标识符、建立关联
  → Compaction 生成摘要（复用 Claude Code 信息提取机制，不造轮子）
  → 写入 Hot/Warm Layer (L1/L2)
  → Agent 通过 MCP 按需获取 context
```

**关键原则**：数据同步靠 API/脚本（零 token），token 只用在 compaction（摘要生成）和 Agent 思考。

### AI-native Goal System

#### 为什么不用传统 OKR

Goal 不是让**人**管理目标，而是让 **Agent** 知道该关注什么。

```
传统 OKR（给人用）           AI-native Goal（给 Agent 用）
─────────────────           ──────────────────────────
"季度目标：DAU 破万"         "关注 PostHog DAU，下降时告诉我"
→ 人每周 check-in           → Agent 自动监控，有事才说
→ 人分析数据                → Agent 跨源分析 + 定位问题
→ 人决策行动                → Agent 建议行动，人审批
→ 巨大 overhead             → 设置一次，Agent 持续执行
```

| 维度 | 传统 OKR（为人类设计） | AI-native Goals（为 Agent 设计） |
|------|----------------------|-------------------------------|
| 目标数量 | 3-5 个（人记不住更多） | 不限，Agent 不会忘记 |
| 更新节奏 | 季度固定 | 实时，数据驱动自动更新 |
| 层级 | O → KR 两层 | Goal → Signal → Measure，任意深度 |
| KR 表达 | 文字描述（"DAU 破万"） | 可计算的 scoring function |
| 评估方式 | 人工季度 check-in | Signal Poller 自动评估 |
| 行动范围 | 人类精力有限，必须取舍 | Agent 可同时推进多条线 |
| 目标调整 | 季度回顾时人工调整 | Agent 可建议演化（带 lineage 追溯） |

#### 对不同用户的价值

| 用户类型 | Goal 怎么用 | 具体例子 |
|---------|-----------|---------|
| Vibe coder（个人） | 告诉 Agent 你在乎什么 | "保持 CI 绿色"、"crash rate < 1%"、"本周 ship 登录功能" |
| 小团队开发者 | 每人设自己的 Agent 目标 | "我负责后端性能"→ Agent 监控 p99 延迟 |
| CEO/PM | 设组织级目标 | "产品 6 月上线，DAU 破万" |

#### Goal → Signal → Measure 三层结构

（参考 Atlassian GSM 框架 + SAGA 目标演化架构）

```
Goal (目标)
├── title: "产品 6 月上线，DAU 破万"
├── status: active | paused | completed | evolved
├── autonomyLevel: copilot | semipilot | autopilot
├── parentId: (支持多层级目标树)
├── evolvedFrom: (目标演化 lineage)
│
├── Signal (方向性指标，绑定数据源)
│   ├── "DAU 持续上升"
│   │   ├── source: posthog → daily_active_users
│   │   ├── direction: maximize
│   │   └── pollInterval: 3600s
│   ├── "关键 milestone 按期交付"
│   │   ├── source: linear → milestone progress
│   │   └── direction: maximize
│   └── "crash rate 持续下降"
│       ├── source: posthog → crash_events / total_events
│       └── direction: minimize
│
└── Measure (可计算阈值，Agent 自动评估)
    ├── posthog.daily_active_users >= 10000
    ├── linear.milestone("launch").progress >= 100%
    └── crash_rate < 0.01
```

#### 自主性分级

- **Copilot**：Agent 建议目标变更/行动，人审批（默认）
- **Semi-pilot**：Agent 自主调整目标，人只审批关键结论
- **Autopilot**：全自动（适合低风险、明确规则的目标）

#### UX 设计原则

1. **不叫 OKR/Goal** — UX 上叫 "Agent Focus" 或 "关注点"（Goal-Signal-Measure 保留为框架名）
2. **不需要正式设置** — 可以自然语言："帮我关注 crash rate"
3. **感觉像配置智能看门狗** — 不像填管理表格
4. **Agent 可以自己提议** — "我注意到你经常查 DAU，要不要我自动监控？"
5. **不强制** — 没有 goal 时 Agent 照常工作（纯数据查询）

#### 运行机制

1. **Signal Poller**：定时通过 API 拉取各数据源的 signal 值，更新 measure.current
2. **Analyzer**：周期性评估 goal 进展，检测异常（signal 反向、reward hacking），建议目标调整
3. **Context Assembler**：Agent 对话时根据 active goals 决定加载哪些层级的 context
4. **Trigger Engine**：signal 达到阈值 / 异常 / 新决策 → 主动通知用户或触发 Agent 行动

#### 主动沟通触发

- 若用户安装了 OpenClaw：link OpenClaw 的主动机制（在 OpenClaw 侧配置）
- 若用户使用其他 Agent 引擎：JoWork 自身的 Trigger Engine，复用 OpenClaw 的机制设计

#### 为什么这是蓝海且有需求

搜遍 GitHub 和产品市场，**没有任何产品**把 AI Agent 和目标追踪结合。但需求是真实的：
- Agent 没有目标 → 只能被动回答问题
- Agent 有目标 → 可以主动监控、主动发现问题、主动推动进展
- 这是 Agent 从"工具"变成"助手"的关键转变

### 多层记忆架构

全量存储所有数据（不过滤、不选择性存储），通过多层架构 + 渐进式信息披露管理 token 消耗：

| 层级 | 内容 | 更新频率 | Agent 获取方式 |
|------|------|---------|---------------|
| L0 Working | 当前对话 context | 实时 | Agent 引擎自管理 |
| L1 Hot | 最近 24-72h 数据摘要 | 持续 compaction | MCP: `get_hot_context()` |
| L2 Warm | 按 Goal 组织的周级趋势/决策摘要 | 每日 compaction | MCP: `get_context_for_goal(id)` |
| L3 Cold | 全量原始数据 | 同步写入 | MCP: `search_data()`, `fetch_content()` |

Agent 平时拿到 L1-L2 摘要（省 token），需要深挖时穿透到 L3 查原文。

Compaction 复用 Claude Code 的信息提取机制（auto-extract、memory 系统），不自建摘要引擎。

### 跨数据源关联

#### 三级渐进策略

**Level 1（Day 1，零 token 成本）：**
- 正则提取标识符：PR#123、LIN-234、commit SHA、URL、@mention
- `object_links` 关联表存储提取到的关系
- FTS 搜索时自动拉取关联对象
- 降低用户手动 link 需求

**Level 2（后续迭代）：**
- 对象 embedding + cosine 相似度阈值
- 时间窗口关联（同一天创建/讨论的相关内容）
- 参与人重叠（同一组人在多个数据源讨论同一件事）
- 自动弱关联

**Level 3（Enterprise）：**
- Temporal Knowledge Graph（参考 Graphiti/Zep）
- Episode → Semantic Entity → Community 三层子图
- 双时间轴：事实创建时间 + 事实有效时间范围
- LLM 提取实体和关系，检索时不依赖 LLM

---

## 二、现状评估

### 代码资产盘点

| 模块 | 来源 | LOC | Electron 依赖 | 复用难度 |
|------|------|-----|---------------|---------|
| MCP Server | `apps/desktop/src/main/mcp/server.ts` | 318 | **零** | Easy — 直接搬 |
| ToolsRegistry | `apps/desktop/src/main/mcp/tools-registry.ts` | 419 | **零** | Easy — 直接搬 |
| ConnectorHub | `apps/desktop/src/main/connectors/hub.ts` | 699 | **零** | Easy — 去掉 credential-store 的 Electron keytar |
| HistoryManager | `apps/desktop/src/main/engine/history.ts` | 512 | **零** | Easy — 只用 better-sqlite3 + drizzle |
| MemoryStore | `apps/desktop/src/main/memory/store.ts` | 165 | **零** | Easy — 直接搬 |
| ContextAssembler | `apps/desktop/src/main/context/assembler.ts` | 155 | **零** | Easy — 纯函数 |
| SyncManager | `apps/desktop/src/main/sync/sync-manager.ts` | 295 | **零** | Easy — fetch API |
| Core Utils | `packages/core/src/utils/` (compaction/fts/tokens) | 233 | **零** | Easy — 纯 TS |
| Core Schema | `packages/core/src/db/schema.ts` | 138 | **零** | Easy — 需扩展 |
| IPC Layer | `apps/desktop/src/main/ipc.ts` | 1100+ | **重度** | **丢弃** — CLI 不需要 |
| Renderer | `apps/desktop/src/renderer/` | ~10K+ | **重度** | **丢弃** |

**结论**：~2700 LOC 核心业务逻辑零 Electron 依赖，可直接提取。Renderer 和 IPC 层丢弃。

### Monorepo 现状

```
package.json          → pnpm workspaces + Turborepo
pnpm-workspace.yaml   → packages: ['apps/*', 'packages/*']
turbo.json            → build/dev/lint/test 四个 task
packages/core/        → schema, types, i18n, utils（保留）
apps/desktop/         → Electron app（将删除）
apps/cloud/           → Hono backend（将删除）
```

---

## 三、目标结构

```
jowork/
├── packages/core/           → 不变，扩展 schema + types
│   ├── src/db/schema.ts     → + goals, signals, measures, object_links 表
│   ├── src/types/           → + goal.ts, connector.ts
│   └── src/utils/           → compaction, fts, tokens（保持）
│
├── apps/cli/                → 新建，CLI 主体
│   ├── package.json         → name: "jowork", bin: { jowork: "./dist/cli.js" }
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   └── src/
│       ├── cli.ts           → Commander.js 入口
│       ├── commands/        → 每个子命令一个文件
│       │   ├── init.ts
│       │   ├── serve.ts
│       │   ├── connect.ts
│       │   ├── sync.ts
│       │   ├── register.ts
│       │   ├── goal.ts
│       │   ├── search.ts
│       │   ├── context.ts
│       │   └── status.ts
│       ├── db/
│       │   └── manager.ts   → 从 HistoryManager 提取，DB 初始化 + 迁移
│       ├── connectors/
│       │   ├── hub.ts       → 从 desktop 提取，去 Electron 依赖
│       │   ├── manifests.ts → 内置 connector 定义
│       │   └── credential-store.ts → 文件存储 + chmod 600
│       ├── mcp/
│       │   ├── server.ts    → 从 desktop 提取，加新工具
│       │   ├── tools-registry.ts → 直接搬
│       │   └── transport.ts → stdio transport 入口
│       ├── memory/
│       │   └── store.ts     → 从 desktop 提取
│       ├── sync/
│       │   └── engine.ts    → 数据同步引擎
│       ├── goals/           → Phase 3 新建
│       │   ├── manager.ts
│       │   ├── signal-poller.ts
│       │   └── analyzer.ts
│       ├── context/
│       │   └── assembler.ts → 从 desktop 提取
│       └── utils/
│           ├── logger.ts    → stdout/stderr + 文件日志
│           ├── config.ts    → ~/.jowork/config.json 读写
│           └── paths.ts     → 数据目录解析
│
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── CLAUDE.md
```

### 数据目录

```
~/.jowork/
├── config.json              → 全局配置
├── data/
│   └── jowork.db            → 主 SQLite 数据库
├── logs/
│   └── jowork.log           → 运行日志
└── credentials/             → 凭证文件（chmod 600）
```

---

## 四、分阶段实施

### Phase 1：Repo 改造 + CLI 骨架 + MCP Server + 零配置 Memory + 飞书同步

**交付物**：`jowork init` + `jowork serve` + `jowork register claude-code` + 零配置跨 session memory + `jowork connect feishu` + `jowork sync` 可工作

> **Eng Review 修正**：原 Phase 1 删除 desktop 后 sync 不存在，导致能力断档。
> 合并后 Phase 1 交付完整链路：init → memory 即用 → connect → sync → serve → Agent 查到真实数据。
> desktop 在真实数据验证通过后才删除。

> **竞品战略修正**：新增"零配置 memory" milestone（1.3），参考 claude-mem 架构。
> 用户旅程变为：
> ```
> 5 秒：npm install -g jowork
> 30 秒：jowork init && jowork register claude-code
> 2 分钟：Claude Code 自动获得跨 session memory（零配置价值）
> 10 分钟：jowork connect feishu/github（进阶：数据源同步）
> ```

#### Step 1.1：创建 apps/cli/ 骨架

**package.json 关键配置**：
```jsonc
{
  "name": "jowork",
  "version": "0.1.0",
  "type": "module",
  "bin": { "jowork": "./dist/cli.js" },
  "dependencies": {
    "@jowork/core": "workspace:*",
    "commander": "^13.0.0",
    "better-sqlite3": "^11.9.0",
    "drizzle-orm": "^0.44.0",
    "@modelcontextprotocol/sdk": "^1.27.0",
    "zod": "^3.24.0",
    "ora": "^8.0.0",
    "chalk": "^5.4.0",
    "inquirer": "^12.0.0"
  }
}
```

打包用 **tsup**（esbuild-based），两个 entry point：
- `src/cli.ts` → `dist/cli.js`（带 shebang）
- `src/mcp/transport.ts` → `dist/transport.js`（MCP server 独立进程入口）

better-sqlite3 使用 **prebuild-install**（CEO Review 决策 #9），npm install 时自动下载预编译 binary，避免用户本地编译。

#### Step 1.2：从 desktop 提取核心模块

复制 → 删除 Electron import → 替换 logger → 验证编译。

| 来源 | 目标 | 改动 |
|------|------|------|
| `desktop/main/mcp/server.ts` | `cli/src/mcp/server.ts` | 替换 logger import |
| `desktop/main/mcp/tools-registry.ts` | `cli/src/mcp/tools-registry.ts` | 替换 logger import |
| `desktop/main/engine/history.ts` | `cli/src/db/manager.ts` | 重命名 DbManager，删除 session/message CRUD，保留 ensureTables + 基础查询 |
| `desktop/main/memory/store.ts` | `cli/src/memory/store.ts` | 替换 logger |
| `desktop/main/context/assembler.ts` | `cli/src/context/assembler.ts` | 替换 logger |
| `desktop/main/connectors/hub.ts` | `cli/src/connectors/hub.ts` | 去 credential-store 的 Electron 依赖，改文件存储 |

#### Step 1.2b：DB 迁移系统（CEO Review 新增）

`ensureTables()` 改为迁移驱动。简单实现：
- `schema_version` 表记录当前版本号
- `migrations/` 目录下顺序 SQL 文件（001_init.sql, 002_object_links.sql, ...）
- `DbManager.migrate()` 依次执行未应用的迁移
- 不用 Drizzle migrate，纯 SQL 文件 + version 表

每个 migration 在独立事务中执行，失败时 rollback 当前 migration 并停止，告知用户运行 `jowork doctor`。

Phase 2/3/5 新增表时只需加迁移文件，用户升级自动执行。

#### Step 1.3：零配置 Memory（竞品战略新增）

参考 claude-mem 架构，实现零配置即可用的跨 session memory：

**核心能力**：
- `jowork init` + `jowork register claude-code` 后，Agent 自动获得跨 session 记忆
- MCP tools: `read_memory`, `write_memory`, `search_memory`（已有，从 desktop 提取）
- MCP tool 内置智能行为（替代 claude-mem 的 lifecycle hooks，因为 MCP 协议无 session 事件）
- Progressive disclosure（摘要 → 详情 → 原文）

**MCP tool 内置行为**（CEO Review #2 修正：hooks → tool 内置）：
- `read_memory`：自动返回最近记忆的 compact 摘要 + 相关上下文，不需要用户指定
- `write_memory`：写入后自动截断（超过 100 条时删除最旧的），保持记忆库精简
- `search_memory`：FTS 搜索 + 时间权重，近期记忆优先
- Progressive disclosure：MCP 工具分层返回（compact index → timeline → full details）

> **Eng Review 修正**（Codex 反馈）：Phase 1 的 memory 管理用简单截断（时间+数量），不消耗 token。
> 真正的 LLM compaction（10x 压缩、CompactionProvider 抽象）放 Phase 5。
> Phase 1 的"零配置"指用户零配置，不指自动 compaction。

**用户体验**：
- 不需要 connect 任何数据源就能获得价值
- Agent 自动记住跨 session 的偏好、决策、项目进展
- 是"数据源连接"的零成本前菜

#### Step 1.4：实现命令

**`jowork init`**：
1. 创建 `~/.jowork/` 目录结构
2. 初始化 SQLite DB（DbManager.migrate() 执行所有迁移）
3. 写入 config.json
4. 输出确认

**`jowork serve`**（两种模式，CEO Review 修正）：

**模式 A: MCP stdio**（被 Agent spawn）：
1. 确认已 init
2. 创建 McpServer（tools + resources）
3. 启动 stdio transport
4. 被 Agent 引擎 spawn 为子进程，生命周期由 Agent 控制
5. 这是 `register` 写入 `~/.claude.json` 的 command

**模式 B: Daemon**（常驻后台，可插拔服务注册）：
1. `jowork serve --daemon`
2. Daemon 启动时加载已注册的服务列表（Eng Review 修正：可插拔设计）
   - Phase 1 注册：cron sync（每 15 分钟同步数据源）
   - Phase 2（原 Phase 3）注册：Signal Poller + channel push 触发器
   - 可选注册：飞书 WebSocket 长连接（`--realtime`）
3. 不占用 stdio（可以 nohup 或 LaunchAgent 运行）
4. PID file 保护（`~/.jowork/daemon.pid`）防重复启动
5. `jowork install-service` 生成 macOS LaunchAgent / Linux systemd 配置（Eng Review 决策：系统级崩溃恢复）

**Plugin 子进程隔离**（Eng Review 决策）：
- 第三方 Syncer 在独立 child_process 中执行
- 主进程不受 plugin crash/hang 影响
- 超时 + kill 机制防止 hang

两者共享同一个 SQLite DB（WAL 模式支持并发读写）。
Agent spawn MCP server 时，daemon 可以同时在后台跑 sync。

**`jowork register <engine>`**（Eng Review 修正：支持多引擎）：
- `jowork register claude-code` → 写入 `~/.claude.json`
- `jowork register codex` → 写入 `~/.codex/config.toml`（Codex 反馈：Phase 1 就支持，不等 Phase 6）
- 复用 ToolsRegistry 的各引擎 sync 逻辑
- **安全措施**（Eng Review #2 新增）：写入前备份原文件（`.bak`），merge 而非覆写（读取现有内容 → 仅添加/更新 JoWork MCP entry），幂等（重复执行不产生重复条目）

**`jowork status`**：
1. 显示 DB 状态（表数据量）
2. 显示各 connector 状态
3. 格式化表格输出

**`jowork doctor`**（CEO Review 新增）：
1. 检查 Node.js 版本（>= 20）
2. 检查 better-sqlite3 native 模块是否正常
3. 检查 DB 文件是否可读写
4. 检查凭证文件是否存在且权限正确
5. 尝试启动 MCP server（dry-run）
6. 检查已注册的 Agent 引擎配置
7. 输出诊断报告（绿色/红色标记）

**`jowork export`**（CEO Review 新增）：
- 导出 DB 为 JSON 或 SQLite 备份文件
- `jowork export --format=json --output=backup.json`
- `jowork export --format=sqlite --output=backup.db`
- SQLite 导出使用 `db.backup()` API（Eng Review 修正：在线安全备份，不用 cp）

#### Step 1.5：飞书连接 + 同步（原 Phase 2 合并）

**`jowork connect feishu`**：inquirer 提示输入 App ID + Secret → 验证 → 存 credentials

**全量同步引擎 + 插件架构（CEO Review 新增）**：

统一接口（同时作为插件接口）：
```ts
interface DataSyncer {
  readonly source: string;
  readonly version: string;
  sync(db: Database, cursor?: string): Promise<SyncResult>;
}
```

**Syncer 插件架构**：
- Built-in syncers 在 `cli/src/sync/builtin/` 下，用同一 `DataSyncer` 接口实现
- **Phase 1 只使用 built-in syncers**（FeishuSyncer）
- 第三方 Syncer 发现机制（`jowork-syncer-*` npm 包自动加载）延期到 Phase 2+（Eng Review 修正：全局 npm 包自动发现在 pnpm/不同包管理器下不可靠，需要更稳定的 plugin 安装方案，如 `~/.jowork/plugins/`）

`jowork sync [--source=feishu]`：读 connector_configs → 调 Syncer → content-hash 去重写入 objects → 更新 sync_cursors

后台同步：`jowork serve` 启动时开启 cron（croner），每 15 分钟自动 sync。

**飞书深化**：
- 群消息全量同步（`im_v1_message_list`，按群遍历）
- **飞书妙记**：订阅 `minutes.minute.created_v1` 事件，会后自动拉全文转录
  - 需要权限：`vc:meeting` + `minutes:minute`
  - 提取决策/action items 作为结构化数据（实体抽取，见 Step 1.6）
- 日历同步（`calendar_v4_event_list`）
- 审批流程（`approval_v4` API，Phase 4 再接入）

#### Step 1.6：跨源关联 L1 + 实体抽取

**标识符正则（零 token）**：
PR#123, LIN-234, commit SHA, URL, @mention → 写入 `object_links` 表。

**实体抽取（零 token，规则引擎）**：
从消息/会议内容中提取：
- 项目名（正则 + 已知项目名词典匹配）
- 人名（@mention + 飞书 user_id 映射）
- 日期/截止时间（正则 + 归一化）
- Action items（"需要"/"TODO"/"截止" 等模式匹配，关联到人）

> LLM 级实体抽取放 Phase 5 Compaction，Phase 1 只做零 token 的规则引擎。
> **Eng Review 修正**（Codex 反馈）：正则抽取必须带 confidence 字段。object_links.metadata 加 `confidence: 'high' | 'medium' | 'low'`。只有 high confidence 的关联才进入 Signal 触发链路，medium/low 仅用于搜索时参考。避免虚假推送。

新增表：
```sql
CREATE TABLE object_links (
  id TEXT PRIMARY KEY,
  source_object_id TEXT NOT NULL REFERENCES objects(id),
  target_object_id TEXT,
  link_type TEXT NOT NULL,    -- 'pr', 'issue', 'commit', 'url', 'mention', 'action_item', 'entity'
  identifier TEXT NOT NULL,
  metadata TEXT,              -- JSON: { assignee, due_date, status } for action_items
  created_at INTEGER NOT NULL
);
```

#### Step 1.7：飞书 WebSocket 实时事件（增强，非必须）

**决策依据**：Polling 15 分钟延迟对群消息够用，但会议/日历事件需要更及时的响应。飞书 Node SDK 支持 WebSocket 长连接（`@larksuiteoapi/node-sdk` 的 `lark.ws()`），**无需公网 endpoint**，可直接在 `jowork serve` 内运行。两种方式零 token 成本（纯 API 调用），互不排斥。

- 在 `jowork serve` 中可选启用飞书 WebSocket 长连接
- 订阅事件：`im.message.receive_v1`、`minutes.minute.created_v1`、`calendar.calendarEvent.changed_v1`
- Webhook 事件触发"立即执行一次增量 sync"，polling 作为兜底（漏事件、进程重启恢复）
- 通过 `jowork connect feishu --realtime` 启用，默认 polling-only

#### Step 1.8：更新配置 + GTM-ready README

- CLAUDE.md：更新架构、命令列表
- turbo.json：不变
- pnpm-workspace.yaml：不变（通配符自动适配）
- README.md：GTM-ready（CEO Review 新增）
  - One-liner: "让 AI Agent 真正理解你的工作。连接数据源，给 Agent 感知能力和行动目标。本地优先，一条命令。"
  - 30 秒 Quick Start（init → register → 在 Claude Code 中使用零配置 memory → connect 进阶）
  - 动画 GIF 演示
  - 明确目标用户：Claude Code / Codex / OpenClaw 用户
  - 竞品差异化矩阵

#### Step 1.9：MCP Resources（CEO Review 新增）

除 MCP tools 外，同时注册 MCP resources：
- `jowork://connectors` — 已连接的数据源列表
- `jowork://memories` — 记忆列表
- `jowork://goals` — 目标列表（Phase 3 启用）
- Agent 可以 list/read resources，更自然地浏览数据

#### Step 1.10：验证

```bash
pnpm install && pnpm lint && pnpm test
cd apps/cli && pnpm build
jowork init && jowork status && jowork serve  # ctrl+c
jowork register claude-code
# Claude Code 中测试 MCP 调用：memory 读写、search_data
```

#### 执行顺序

```
1.1  CLI 骨架 + package.json + tsconfig
 ↓
1.2  提取 core 模块（mcp, db, memory, connectors）
1.2b DB 迁移系统
 ↓
1.3  零配置 Memory（lifecycle hooks + progressive disclosure）  ← 竞品战略新增
 ↓
1.4  实现 CLI 命令（init, serve, register, status, doctor, export）
 ↓
1.5  飞书连接 + 同步（connect, sync）
 ↓
1.6  跨源关联 L1 + 实体抽取
 ↓
1.7  飞书 WebSocket 实时事件（可选增强）
 ↓
1.8  更新 CLAUDE.md + GTM-ready README
 ↓
1.9  MCP Resources
 ↓
1.10 端到端验证 ← checkpoint: 零配置 memory + 真实飞书数据可查
 ↓
1.11 删除 apps/desktop/ + apps/cloud/
 ↓
1.12 pnpm lint + pnpm test 全绿
```

---

### ~~Phase 2：已合并入 Phase 1~~（Eng Review 决策）

> 原 Phase 2 的所有内容（数据源连接 + 持久化 + 实时事件增强）已合并入 Phase 1，消除能力断档。

---

### Phase 3：Goal System

**交付物**：Goal-Signal-Measure 全链路

#### 新增 DB 表

```sql
CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  autonomy_level TEXT NOT NULL DEFAULT 'copilot',
  parent_id TEXT REFERENCES goals(id),
  evolved_from TEXT REFERENCES goals(id),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE signals (
  id TEXT PRIMARY KEY,
  goal_id TEXT NOT NULL REFERENCES goals(id),
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  metric TEXT NOT NULL,
  direction TEXT NOT NULL,
  poll_interval INTEGER DEFAULT 3600,
  config TEXT,
  current_value REAL,
  last_polled_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE measures (
  id TEXT PRIMARY KEY,
  signal_id TEXT NOT NULL REFERENCES signals(id),
  threshold REAL NOT NULL,
  comparison TEXT NOT NULL,
  upper_bound REAL,
  current REAL,
  met INTEGER DEFAULT 0,
  last_evaluated_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

#### CLI 命令

```bash
jowork goal add "产品 6 月上线，DAU 破万"
jowork goal list [--status=active]
jowork goal status [<goal_id>]
jowork signal add <goal_id> --source=posthog --metric=dau --direction=maximize
jowork measure add <signal_id> --threshold=10000 --type=gte

# 自然语言创建（Agent 对话中）
# 用户: "帮我关注 crash rate"
# → Agent 调 MCP update_goal 自动创建 Goal + Signal
```

#### Goal System UX 指南（竞品战略新增）

Goal-Signal-Measure 保留框架名，但 UX 层面：
- 设置 goal 的体验像"告诉 Agent 你在乎什么"，不像"填 OKR 表格"
- 支持自然语言创建：Agent 对话中说"帮我关注 crash rate"自动创建
- Agent 可以自己提议：发现用户反复查某指标 → 建议自动监控
- copilot 模式：Agent 建议，人审批（默认）
- 不强制所有场景都要 goal — 没有 goal 时 Agent 照常工作（纯数据查询）

#### MCP 新工具

| 工具 | 描述 |
|------|------|
| `get_goals` | 活跃目标及进展 |
| `get_context_for_goal` | 按目标组装 context |
| `get_blockers` | 阻塞项检测 |
| `get_metrics` | signal/measure 最新值 |
| `update_goal` | Agent 建议变更（copilot 需人审批） |
| `push_to_channel` | 推送消息到指定 channel（飞书/Slack/Telegram/...） |

#### Signal Poller + Analyzer

- `jowork serve` 中定时运行，按 poll_interval 拉取各数据源
- 评估 goal 进展，检测异常（signal 反向、reward hacking）

#### Channel 推送（Phase 3 同步交付）

主动推送**不特化飞书**，飞书是一个 channel。统一 channel 抽象：

```ts
interface NotifyChannel {
  readonly id: string;       // 'feishu', 'slack', 'telegram', ...
  send(message: ChannelMessage): Promise<void>;
}
```

- 飞书 channel：复用已连接的 Bot 凭证，调 `im_v1_message_create` 发消息/卡片
- OpenClaw channel：如果底层引擎是 OpenClaw，直接复用其通知机制
- 其他 channel：Slack webhook、Telegram bot 等后续扩展

触发场景（Phase 3 交付）：
- Signal 异常（指标反向、连续下降）→ 推送到配置的 channel
- Measure 达标/未达标 → 推送
- 检测到矛盾决策、超期 action item → 推送

MCP 工具 `push_to_channel` 也暴露给 Agent，Agent 可主动决定推送。

---

### Phase 4：更多数据源

| 数据源 | Syncer 类 | API | 优先级 |
|--------|-----------|-----|--------|
| GitHub | GitHubSyncer | REST v3 + GraphQL | P1 |
| GitLab | GitLabSyncer | REST v4 | P1 |
| 飞书文档 | FeishuDocSyncer | docx + wiki API | P1 |
| 飞书审批 | FeishuApprovalSyncer | approval_v4 API | P2 |
| Linear | LinearSyncer | GraphQL | P2 |
| PostHog | PostHogSyncer | REST | P2 |
| Firebase | FirebaseSyncer | Admin SDK | P2 |

---

### Phase 5：多层记忆 + 高级关联

#### 多层存储

| 层级 | 表 | 生成方式 | MCP 工具 |
|------|---|---------|---------|
| L1 Hot | `memory_hot` | Compaction（24-72h 窗口） | `get_hot_context()` |
| L2 Warm | `memory_warm` | Compaction（按 Goal 聚合） | `get_context_for_goal()` |
| L3 Cold | `objects` + `object_bodies` | 原始同步 | `search_data()` + `fetch_content()` |

Compaction：定时扫描 L3 增量 → 通过可插拔 LLM provider 做信息提取 → 写入 L1/L2。
> **Eng Review 修正**（Codex 反馈）：Compaction 的 LLM 调用通过抽象接口（`CompactionProvider`），不硬绑 Claude Code CLI。默认用 Anthropic API，也可切换 OpenAI/本地模型。保持 "any Agent engine" 承诺。

**Supermemory 移植内容**：
- Semantic chunking（替代固定大小分块）
- Container tag isolation（team 模式隔离）
- User profile generation（Agent 理解用户偏好）

#### 跨源关联 L2

- Embedding 相似度（cosine > 0.85）
- 时间窗口（±2h + 参与人重叠）
- link_type: 'semantic' | 'temporal' | 'participant'

---

### Phase 6：设备 Sync + Agent 集成

- 设备间 SQLite sync（sync_queue + CAS 乐观并发）
- `jowork register openclaw` / `jowork register codex`
- Trigger Engine 增强：更多触发条件 + 更多 channel + Agent 自主行动能力

---

## 五、数据源优先级

| 优先级 | 数据源 | 现状 | 说明 |
|--------|-------|------|------|
| P0 | 飞书群消息 | 已有基础（Feishu MCP） | 深化：全量同步 + 持久化 |
| P0 | 飞书会议 | 无 | 参会人 + 逐字稿（API） + 实时参会（探索） |
| P1 | 飞书文档 | 部分 | 扩展 wiki 权限 |
| P1 | GitHub/GitLab | 已有（MCP connector） | 深化：持久化 + 关联 |
| P2 | PostHog | 无 | 用户行为、funnel、crash |
| P2 | Firebase | 无 | 埋点数据 |
| P2 | Linear | 无 | Issue/milestone（无 project 维度，需自设计关联） |
| P3 | 飞书邮件 | 无 | 个人数据，需 OAuth |
| P3 | 本地文件 | 已有 | 保持 |

---

## 六、部署模式

### Case 1: 个人本地（最先实现）
```
macbook/mac-mini: jowork serve → MCP server
                  Agent (Claude Code / Codex / OpenClaw) 连接 MCP
                  数据全在本地 SQLite
```

### Case 2: 个人远端（后续）
```
macbook: jowork (查看/管理) ◄──sync──► mac mini: jowork serve + OpenClaw
```

### Case 3: 企业（远期）
```
成员设备: jowork ◄──sync──► Cloud Server (集中存储 + 权限控制)
```

---

## 七、CLI 命令完整设计

```bash
# 初始化
jowork init                              # 初始化项目，创建本地 DB
jowork doctor                            # 诊断检查
jowork export --format=json              # 数据备份

# 零配置 Memory（Phase 1.3）
jowork register claude-code              # 注册到 ~/.claude.json（memory 即用）
jowork register codex                    # 注册到 ~/.codex/config.toml

# 数据源连接
jowork connect feishu                    # 交互式连接飞书（Phase 1）
jowork connect github                    # Phase 4
jowork connect posthog --api-key=xxx     # Phase 4
jowork connect linear --token=xxx        # Phase 4

# 同步
jowork sync [--source=feishu]            # 手动触发同步

# 运行
jowork serve                             # 启动 MCP server (stdio, 被 Agent spawn)
jowork serve --daemon                    # 后台 daemon（cron sync + signal poller）
jowork install-service                   # 生成 LaunchAgent / systemd 配置

# 目标系统（Phase 3）
jowork goal add "产品 6 月上线"           # 添加 Goal
jowork goal list                         # 查看所有 Goals
jowork signal add <goal_id> \
  --source=posthog --metric=dau \
  --direction=maximize                   # 绑定 Signal
jowork measure add <signal_id> \
  --threshold=10000 --type=gte           # 设置 Measure
jowork goal status [<goal_id>]           # 查看 Goal 进展

# 查询
jowork status                            # 同步状态 + DB 概览
jowork context [--goal=<id>]             # 输出 context briefing
jowork search "登录页 crash"              # 跨数据源搜索
```

---

## 八、Schema 变更汇总

### 保留（从 desktop 继承）

settings, connector_configs, objects, object_bodies, object_chunks, sync_cursors, memories, objects_fts

> **Eng Review 修正**：`scheduled_tasks` 和 `task_executions` 从保留列表移除（desktop scheduler 残留）。
> Phase 3 的 Signal Poller 需要时重新设计调度表。

### 删除（聊天相关）

sessions, messages, engine_session_mappings, messages_fts, context_docs

### 新增

| 表 | Phase | 用途 |
|---|-------|------|
| object_links | 1 | 跨源关联 |
| goals | 3 | 目标 |
| signals | 3 | 信号 |
| measures | 3 | 度量 |
| memory_hot | 5 | L1 热数据摘要 |
| memory_warm | 5 | L2 温数据摘要 |

---

## 九、技术决策记录

| # | 决策 | 选择 | 拒绝方案 | 拒绝理由 | 重新采用条件 |
|---|------|------|---------|---------|-------------|
| 1 | 打包工具 | tsup | rollup（配置复杂）, esbuild 裸用（缺 dts） | KISS | 需要 tree-shaking 优化时考虑 rollup |
| 2 | 凭证存储 | 文件 + chmod 600 + 可选 AES-256-GCM 加密 | keytar（native 编译） | CLI 标准做法 + 可选加密满足安全需求，`jowork config set encryption on` 启用 | — |
| 3 | CLI 框架 | Commander.js | oclif（太重）, yargs（API 不简洁） | 最成熟 + TS 支持好 | 需要 plugin 架构时考虑 oclif |
| 4 | MCP 传输 | stdio | HTTP/SSE（端口管理复杂） | MCP 标准，所有引擎支持 | 需要远程连接时加 SSE |
| 5 | 删除 desktop | 完全删除 | 保留兼容 | 产品方向转变，双代码库浪费 | 不会发生 |
| 6 | 删除 cloud | 完全删除 | 保留 | Phase 6 需要时从 CLI 模块重建 | Phase 6 |
| 7 | 数据同步方式 | Polling 优先 + WebSocket 可选增强 | 纯 Webhook（需公网 endpoint）| 飞书 SDK 支持 WS 长连接无需公网，但 polling 更简单且延迟可接受。两者零 token 成本，互补使用 | Phase 2.5 加 WebSocket |
| 8 | 主动推送架构 | 通用 channel 抽象 | 特化飞书推送 | 飞书只是 channel 之一，OpenClaw 等引擎有自己的通知机制可复用 | — |
| 9 | Native 模块分发 | npm + prebuild-install | 用户本地编译 | 避免 node-gyp 编译失败，预编译 binary 覆盖主流平台 | — |
| 10 | Goal System 命名 | **保留 Goal** | 改名 Focus/Watch | Goal-Signal-Measure 是完整框架名，UX 上弱化 OKR 感即可 | — |
| 11 | 竞品代码复用 | **claude-mem + Supermemory 两者都移植** | 只学一个 | claude-mem hooks+压缩(AGPL) + Supermemory pipeline+graph(MIT)，互补 | — |
| 12 | Phase 1 优先级 | **Memory 提到最前** | connect 先行 | 零配置即可用 → connect 进阶 → Goal 高阶 | — |
| 13 | 产品定位 | Agent Infrastructure | "MCP server"、"Memory for AI" | 避开拥挤赛道，强调完整基础设施而非单点能力 | — |
| 14 | 产品本质 | Agent 的感知层 + 行动层（中间层） | APP / 记忆系统 / MCP server | 不是单点能力，是让 Agent 从聊天工具变自主助手的完整中间层 | — |
| 15 | 非开发者体验 | AI Agent 本身就是界面（MCP = UX） | 单独建 Web UI | 对话就是界面，MCP tool description 质量决定非开发者 UX | 需要可视化监控时加 `jowork dashboard` |
| 16 | 产品独立性 | JoWork 是完全独立的产品，与 Jovida 无关 | 作为 Jovida 基建层 | JoWork 有自己的用户群和商业化路径，不依赖任何其他产品 | — |
| 17 | 商业化模式 | Open Core（单人免费 + 团队 $30/user/月） | 纯 SaaS / 纯开源 | 兼顾社区增长和商业收入；AGPL 强制商业嵌入付费 | — |
| 18 | 第一阶段重心 | Traction > Revenue（6 个月内纯免费） | 先收费 | 0→1 阶段用户数和社区比收入更重要 | 有明确 PMF 信号后加速收费 |

---

## 十、待调研问题（Open Questions）

| # | 问题 | 影响 Phase | 优先级 |
|---|------|-----------|--------|
| 1 | npm 包名 `jowork` 是否可用？备选 `@jowork/cli` | 1 | P0 — 开工前确认 |
| 2 | 飞书妙记 API 权限（`vc:meeting` + `minutes:minute`）是否对现有 Bot 可用？ | 1 | P1 |
| 3 | Compaction token 成本：Claude Code CLI `-p` 模式处理日均飞书消息量的实际花费？需 benchmark | 5 | P2 |
| 4 | 正则实体抽取（Step 1.6）能产出多少有用关联？是否需要提前引入 LLM 级抽取？ | 1 | P2 |
| 5 | OpenClaw 当前 MCP 支持状态，决定 Phase 6 集成方式 | 6 | P3 |
| 6 | ChatClaw 飞书集成深度：他们踩了哪些坑、用户反馈是什么？ | 1 | P1 |

---

## 十一、风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| better-sqlite3 跨 Node 版本编译失败 | 安装失败 | 锁定 Node 20 LTS，CI 多版本测试 |
| 飞书 API rate limit | 同步中断 | 指数退避 + sync_cursors 断点续传 |
| Compaction token 成本失控 | 费用过高 | 增量 compaction + 每日预算限制 |
| npm 包名 `jowork` 被占 | 发布失败 | 备选 `@jowork/cli` |
| stdio MCP 进程管理 | 僵尸进程 | signal handler + graceful shutdown |

---

## 十二、验收标准

### Phase 1 Done

```bash
npm install -g .
jowork init                       # ~/.jowork/ + SQLite DB 创建成功
jowork status                     # 输出状态
jowork serve                      # MCP server 启动（ctrl+c 退出）
jowork register claude-code       # ~/.claude.json 写入成功
claude "用 read_memory 读取记忆"   # 零配置 memory 工作
claude "用 search_data 搜索 test" # MCP 工具调用成功
jowork connect feishu             # 交互式连接成功
jowork sync                       # 数据同步到 SQLite
jowork search "关键词"             # 搜到数据
claude "飞书群里最近讨论了什么"     # Agent 通过 MCP 查到真实数据
pnpm lint                         # 零错误
pnpm test                         # 全部通过
```

### 架构质量标准

- 新增一个数据源只需要一个 Syncer 文件（实现 `DataSyncer` 接口）
- 新增一个 MCP 工具只需要在 `server.ts` 加一个 `server.tool()` 调用
- 新增一个推送 channel 只需要实现 `NotifyChannel` 接口

### 测试策略（CEO Review 新增）

**Phase 1 必须覆盖**：
- Unit: DbManager（migrate、CRUD）、MemoryStore、MCP server tools（search_data、read_memory 等）
- Integration: `init → serve → MCP 调用` 全链路（spawn MCP server 子进程，通过 stdio 调用 tool）
- CLI: 每个命令的 happy path + 常见错误路径

**Phase 1 追加**（飞书同步已合并到 Phase 1）：
- Syncer interface 合规测试（built-in + mock 第三方 plugin）
- Feishu API mock 测试（rate limit、token 过期、网络中断）
- Plugin 加载/卸载/报错隔离
- `jowork register` merge 测试（备份、幂等、损坏 JSON 恢复）（Eng Review #2 新增）
- 并发写入测试（daemon sync 批量写入 + MCP write_memory 同时执行）（Eng Review #2 新增）
- Migration 部分失败测试（corrupt SQL → rollback + 报错停止）（Eng Review #2 新增）

**Phase 3 追加**：
- Goal-Signal-Measure CRUD + Signal Poller 定时逻辑
- Channel push 触发条件测试

---

## 十三、明确排除

1. 不做 Web UI / Dashboard（未来可选 `jowork dashboard`）
2. 不做 Agent 引擎（JoWork 是数据层 + 目标系统）
3. 不做用户认证系统
4. 不做 team 协作（Phase 1-5）
5. macOS/Linux first，Windows 后续
6. 不自建 embedding 模型（用 OpenAI API 或本地 ONNX）
7. 不自建 compaction 引擎（复用 Claude Code CLI 或 Anthropic API）

---

## 十四、MCP 工具完整清单

### Phase 1（继承 + 新增）

继承：search_data, list_sources, fetch_content, fetch_doc_map, fetch_chunk, read_memory, write_memory, get_environment
新增：search_memory（零配置 memory 的搜索）

> **Eng Review 修正**（Codex 反馈）：`notify` 和 `list_tasks` 从 Phase 1 移除，
> 它们是 desktop 残留，在 CLI 架构中未重新定义所有权。
> `notify` 功能由 Phase 3 的 `push_to_channel` 替代。

### Phase 3（Goal System + Channel 推送）

get_goals, get_context_for_goal, get_blockers, get_metrics, update_goal, push_to_channel

### Phase 5（多层记忆）

get_hot_context, get_briefing

---

## 十五、参考资料

- [SAGA: Autonomous Goal-Evolving Agents (Cornell 2025)](https://arxiv.org/abs/2512.21782)
- [OKR-Agent (ICLR)](https://www.semanticscholar.org/paper/Agents-meet-OKR)
- [Atlassian Goals-Signals-Measures](https://www.atlassian.com/team-playbook/plays/goals-signals-measures)
- [Anthropic Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [Graphiti/Zep Temporal KG](https://github.com/getzep/graphiti)
- [A-MEM (NeurIPS 2025)](https://arxiv.org/abs/2409.07286)
- [Microsoft Azure Agent Orchestration](https://learn.microsoft.com/en-us/azure/architecture/ai-ml/guide/ai-agent-design-patterns)
- [claude-mem (AGPL-3.0)](https://github.com/anthropics/claude-mem) — lifecycle hooks, 10x compression, progressive disclosure
- [Supermemory (MIT)](https://github.com/supermemoryai/supermemory) — 6-stage pipeline, relationship modeling, semantic chunking
- [ChatClaw](https://github.com/nicepkg/chatclaw) — 飞书集成参考（Go, 160 stars）
