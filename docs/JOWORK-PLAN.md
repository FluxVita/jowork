# Jowork — 产品与技术总纲

> **版本**: v1.4
> **日期**: 2026-03-04
> **状态**: 规划中，待逐步实施（所有关键决策已拍板，可进入 Phase 0）
> **定位**: 本文档是 Jowork 产品拆分、开源、商业化的总设计参考，贯穿整个开发周期反复使用。

---

## 零、AI 开发工作规范

> 本节是所有参与 Jowork 开发的 AI 工程师（Claude 实例）的行为准则。**每次会话开始时必须读取并遵守**。规范高于技术偏好，不得以任何理由绕过。

---

### 0.1 专注原则：每次只开发 1-2 项

**不要同时推进过多任务。** 每次会话只认领当前 Phase 中 1 个或最多 2 个强相关的子任务，完整开发并测试通过后，再自动认领下一个。

```
✅ 正确节奏：
  认领任务 → 全局看 Plan → 开发 → 自测 → 提交 → 认领下一个

❌ 错误节奏：
  同时开几个任务 → 都做了一半 → 产生混乱的中间状态 → 难以测试
```

**认领任务前必须做的检查**：
1. 读当前 Phase 的完整任务列表，理解上下游依赖
2. 看最近 10 条 git log，了解其他 AI 做了什么
3. 确认自己即将改的文件近期没有其他人在改（`git log --oneline -5 -- <文件>`）

---

### 0.2 全局视角：动手前先想全局影响

**开发任何功能前，先问自己**：

- 这个改动会影响哪些已有模块？（搜索相关 import/引用）
- 这个改动的设计，是否和 Plan 文档中其他章节描述的方向一致？
- 如果这个设计现在做错了，后面改的代价有多大？

**重点参考文档**：
- 本文档（JOWORK-PLAN.md）**第三十一节**（并行开发策略）+ **第三十二节**（架构决策）
- `CLAUDE.md`——当前项目约定
- `AGENTS.md`——多 AI 协作规范

---

### 0.3 遇到不确定问题：主动问 Aiden，但用大白话

**什么时候问**：遇到有多个方向、不知道该怎么选、或者这个决策会影响很多后续工作的时候。**不要自己猜测 Aiden 的偏好然后埋头做**。

**怎么问**：Aiden 不是技术开发者，不懂代码实现细节。问问题时要：
1. **用类比解释**，不要用技术术语
2. **列出选项**，每个选项说清楚"用户感受到的区别是什么"
3. **给出推荐**，但说明为什么推荐这个

**问法示例**：

> ❌ 不好的问法：
> "请问 Personal 模式是否应该使用 Bun SEA 还是 pkg 来打包 Node.js sidecar？"

> ✅ 好的问法：
> "Personal 模式的服务打包有两种方式：
> - 方式 A（推荐）：像做一道成品菜一样，把所有东西打包成一个文件，用户安装后直接能用，但最终安装包大约 80MB
> - 方式 B：只打包菜谱，用户机器上要先装个'厨房'（Node.js），包更小（5MB），但安装步骤多一步
> 我推荐方式 A，因为开源项目最重要的是'零配置开箱即用'。你觉得哪种体验更适合 Jowork？"

**什么时候不用问**：纯技术实现细节（用哪个库、怎么写代码、如何修 bug）不需要问，直接解决。

---

### 0.4 参考项目：设计时对照这两个开源项目

在涉及 **Agent 架构、插件扩展、API 设计、安全、性能** 的功能开发时，必须参考以下两个项目：

| 项目 | 地址 | 参考方向 |
|------|------|---------|
| **OpenClaw** | https://github.com/openclaw/openclaw | Agent 生命周期管理、skill 插件体系、权限模型、多渠道通信 |
| **NanoClaw** | https://github.com/qwibitai/nanoclaw | 轻量 Agent 实现、扩展性设计、开源友好的接口设计 |

**参考时要做的事**：
```
1. 看它们如何定义对外接口（用户怎么扩展、第三方怎么接入）
2. 看它们的安全模型（权限怎么管、敏感数据怎么处理）
3. 看它们遇到和我们类似的问题时是怎么解决的
4. 如果它们有现成的组件可以直接复用（npm 包、设计模式），优先复用，不重复造轮子
```

**不要盲目照抄**，参考的目的是借鉴好的设计决策，Jowork 有自己的产品定位和技术约束。

---

### 0.5 遇到问题的解决顺序

遇到任何技术难题，按以下顺序解决，**不要在技术问题上过多咨询 Aiden**：

```
第一步：看开源社区有没有现成方案
  ↓  搜索 npm/GitHub，看有没有成熟的库直接解决这个问题
  ↓  优先复用，避免从零实现

第二步：搜索别人如何解决同类问题
  ↓  搜索关键词 + StackOverflow / GitHub Issues / 官方文档
  ↓  找到至少 2 个参考案例再动手

第三步：参考 OpenClaw / NanoClaw 的实现
  ↓  看它们遇到类似问题时的解法

第四步：自己设计并实现
  ↓  实现后必须通过测试才能提交

第五步（例外）：影响产品方向或用户体验的决策
  → 这才需要问 Aiden，且用大白话问
```

---

### 0.6 开发→测试→下一项 的闭环

**每个功能开发完，必须自测后再提交，测试通过后自动开展下一项，不要中途停下来等待确认。**

```
开发完一个功能
  ↓
自测（根据功能类型选择）：
  ├── 后端 API 改动 → 跑 npm run test，确认相关用例通过
  ├── 前端 UI 改动 → 在浏览器里走一遍主要操作流程
  ├── Rust/Tauri 改动 → cargo check 通过，tauri:dev 验证基本功能
  └── 数据库改动 → 确认表结构正确，相关查询返回预期结果
  ↓
测试通过 → git commit → git push
  ↓
自动认领下一个任务（继续 0.1 流程）
  ↓
（仅以下情况才停下来报告 Aiden）：
  ├── 遇到影响设计方向的决策点
  ├── 发现 Plan 中有明显矛盾或遗漏
  ├── 某个功能测试始终无法通过，自己解决不了
  └── 完成当前 Phase 的全部任务
```

---

### 0.7 当前开发状态追踪

> 每次会话结束时，更新此表格，让下一个 AI 知道进度。

| Phase | 状态 | 最后更新 | 备注 |
|-------|------|---------|------|
| Phase -1：稳定化（清零 3 个阻塞） | ✅ 完成 | 2026-03-04 | N/A：本仓库从零构建，无旧代码阻塞 |
| Phase 0：Monorepo 骨架 | ✅ 完成 | 2026-03-04 | pnpm workspaces + tsconfig 骨架 + edition.ts + pnpm lint 全绿 |
| Phase 1：抽取 core 包 | ✅ 完成 | 2026-03-04 | 全部14个模块实现完毕：types/config/utils/datamap/auth/policy/gateway/memory/models/agent/scheduler/connectors/channels/services/onboarding；pnpm lint+test全绿 |
| Phase 2：抽取 premium 包 | ✅ 完成 | 2026-03-04 | activatePremium + dispatcher + claude-agent + embedding + geek-mode + alerts + skills + klaude-manager + context；pnpm lint+test全绿 |
| Phase 3：apps/jowork | ✅ 完成 | 2026-03-04 | Express gateway + sessions/chat/memory/connectors 路由 + Vue 3 CDN SPA（暗色主题聊天界面）；pnpm lint全绿 |
| Phase 4：apps/fluxvita | ✅ 完成 | 2026-03-04 | activatePremium + 完整 Express gateway（sessions/chat/memory/connectors/premium 路由）+ FluxVita 品牌 SPA + Klaude 状态 API + 飞书 OAuth 占位；pnpm lint+test全绿 |
| Phase 5：CI/CD + GitHub 同步 | ✅ 完成 | 2026-03-04 | ci.yml + .gitlab-ci.yml（双 app lint+test+build）+ sync-to-github.sh；首次 push 需 GitHub repo 存在 |
| Phase 6：三层上下文系统 | ✅ 完成 | 2026-03-04 | ContextDoc 类型 + context_docs/FTS 表已存在 + context/index.ts（CRUD+组装+自学习+workstyle shortcut）+ context 路由（两 app）；pnpm lint+test全绿 |
| Phase 7：开源清理 + 安全审计 | ✅ 完成 | 2026-03-04 | 扫描无硬编码凭证；.env.example + .gitignore 完善；ci.yml 增加 TruffleHog secret scan job |
| Phase 8：扩展性重构 | ✅ 完成 | 2026-03-05 | JCP 协议接口 + ModelProvider 注册器（Anthropic/OpenAI/Ollama 内置）+ JoworkChannel 接口 + GitHub/Notion connector + Telegram channel；pnpm lint+test全绿 |
| Phase 9：平台兼容 + 国际化 + Docker | ✅ 完成 | 2026-03-05 | Windows兼容审计通过 + i18n框架（en/zh + registerLocale）+ Docker（cycle 4）+ README文档更新；pnpm lint+test全绿 |
| Phase 10：首次公开发布 | ✅ 完成 | 2026-03-05 | CODE_OF_CONDUCT.md ✅；CONTRIBUTING.md ✅；GitHub org创建/同步/Discussions/Release需人工执行（人工任务已标注） |
| Phase 22：Slack连接器 + JCP自动注册 | ✅ 完成 | 2026-03-05 | slackConnector + 自动注册GitHub/Notion/Slack + ConnectorKind扩展('github'\|'notion'\|'slack') + discoverViaConnector桥接 + listAllConnectorTypes；pnpm lint+test全绿（92/92） |
| Phase 23：Linear + GitLab JCP连接器 | ✅ 完成 | 2026-03-05 | linearConnector(GraphQL issues/search) + gitlabConnector(REST projects/MRs/issues，支持自托管baseUrl)；pnpm lint+test全绿（102/102） |
| Phase 24：Figma JCP连接器 | ✅ 完成 | 2026-03-05 | figmaConnector(files/components/pages；teamId+fileKeys配置；搜索组件)；pnpm lint+test全绿（108/108） |
| Phase 11：安全加固 | ✅ 完成 | 2026-03-05 | SensitivityLevel类型+字段（MemoryEntry/ContextDoc/DB schema）+ Connector defaultSensitivity + Context PEP（assembleContext按role过滤）+ 聚合stats API + Agent跨用户防护 + session所有权校验；pnpm lint+test全绿（18/18） |
| Phase 12：性能优化 | ✅ 完成 | 2026-03-05 | Semaphore(2)+LRU cache+LLM限流(1req/s)+DB维护(TTL+optimize)+Node.js Cluster+LaunchAgent；pnpm lint+test全绿（28/28） |
| Phase 13：网络架构 | ✅ 完成 | 2026-03-05 | mDNS广播(UDP multicast)+Tunnel管理(cloudflared spawn)+/api/network/info发现端点+docs/custom-domain.md；pnpm lint+test全绿（36/36） |
| Phase 14：版本更新基础设施 | ✅ 完成 | 2026-03-05 | schema_migrations表+migrator.ts(含bootstrap+热备份)+001_initial内联迁移+backupDb+adminRouter(更新检查/手动备份/迁移列表)；pnpm lint+test全绿（44/44） |
| Phase 15：生产可靠性 | ✅ 完成 | 2026-03-05 | gracefulShutdown(WAL checkpoint+drain)+integrity_check+磁盘空间告警+Connector自愈(withRetry指数退避+健康跟踪)+敏感数据脱敏(logger maskMeta)+/health/full全链路检查；pnpm lint+test全绿（49/49） |
| Phase 16：备份恢复 | ✅ 完成 | 2026-03-05 | buildExportZip+buildExportJson+buildExportCsv+buildExportMarkdown+restoreFromZip(admin.ts路由)+startBackupScheduler(每日03:00自动备份)；pnpm lint+test全绿（62/62） |
| Phase 17：法律文档 | ✅ 完成 | 2026-03-05 | ToS+PrivacyPolicy+退款政策(docs/legal/)；AGPL FAQ加入README；.claassistant.yml；部署jowork.work需人工执行 |
| Phase 18：付费系统集成 | ✅ 完成 | 2026-03-05 | subscription/index.ts(daily拉取+7天grace period状态机+本地缓存)；activatePremium改为async+opts；/api/premium/subscription端点+upgradeUrl；Stripe/jowork.work后端需人工配置；pnpm lint+test全绿（62/62） |
| Phase 19：LLM成本管理 | ✅ 完成 | 2026-03-05 | llm_usage+budget_config表；recordUsage+estimateCost；/api/usage/summary|daily|budget|recommend|team路由；17个新测试；pnpm lint+test全绿（79/79） |
| Phase 20：GTM准备 | ✅ 完成 | 2026-03-05 | quick-start.md(3种安装方式)；product-hunt.md(tagline+文案)；reddit-hn.md(4平台帖子)；官网/视频/Discord需人工执行 |
| Phase 25：Discord Channel | ✅ 完成 | 2026-03-05 | discordChannel（webhook发送+rich embeds+bot轮询接收）；pnpm lint+test全绿（124/124） |
| Phase 26：Channels REST API | ✅ 完成 | 2026-03-05 | channels/router.ts（列表/init/message/shutdown端点）+ env自动初始化 + 协议状态追踪；pnpm lint+test全绿（137/137） |
| Phase 27：Scheduler REST API + Webhook Channel | ✅ 完成 | 2026-03-05 | schedulerRouter(/api/tasks CRUD)+ webhookChannel(inbound Bearer auth+outgoing POST)+两个app均挂载；pnpm lint+test全绿（156/156） |
| Phase 28：Agent 管理 + Onboarding REST API | ✅ 完成 | 2026-03-05 | agentsRouter(/api/agents CRUD，owner隔离)+onboardingRouter(/api/onboarding GET+POST /advance)；两app均挂载；pnpm lint+test全绿（168/168） |
| Phase 29：User 管理 REST API | ✅ 完成 | 2026-03-05 | usersRouter(/api/users/me+列表+创建+PATCH+DELETE；owner/admin权限分级；新用户自动签发token；防自删)；两app均挂载；pnpm lint+test全绿（182/182） |
| Phase 30：Sessions REST API（移入 core + 补全端点） | ✅ 完成 | 2026-03-05 | sessionsRouter移入core（PATCH title+DELETE session级联+DELETE message）；两app删除重复路由改用core router；pnpm lint+test全绿（197/197） |
| Phase 31：Chat/Connectors/Memory/Context/Stats 路由移入 core | ✅ 完成 | 2026-03-05 | chatRouter(dispatchFn?)+connectorsRouter+memoryRouter+contextRouter+statsRouter移入core；两app删除重复路由；fluxvita通过chatRouter(dispatch)注入premium引擎；pnpm lint+test全绿（210/210） |
| Phase 32：SSE 流式聊天端点 | ✅ 完成 | 2026-03-05 | chatStream()异步生成器（Anthropic streaming API）+ POST /api/sessions/:id/messages/stream SSE端点（chunk/done/error事件）；pnpm lint+test全绿（217/217） |
| Phase 33：Connector Fetch + Search API | ✅ 完成 | 2026-03-05 | connectorSearch()函数（能力门控，无search抛NOT_SUPPORTED）+ POST /api/connectors/:id/fetch + POST /api/connectors/:id/search；pnpm lint+test全绿（222/222） |
| Phase 34：前端 SSE 流式渲染 + 停止生成 | ✅ 完成 | 2026-03-05 | apps/jowork + apps/fluxvita 均升级为 SSE stream 端点；流式光标+停止按钮；pnpm lint+test全绿（222/222） |
| Phase 35：OpenAI-compatible 流式 + Ollama 开箱即用 | ✅ 完成 | 2026-03-05 | streamOpenAI()（OpenAI SSE格式）+ chatStream()路由到openai format + discoverOllamaModels()自动发现 + /api/models路由（providers/active/ollama-discover）；pnpm lint+test全绿（231/231） |
| Phase 36：Agent 内置工具集扩展 | ✅ 完成 | 2026-03-05 | create_memory+fetch_connector+search_connector+list_context 4新工具+getToolSchemas()+/api/agent/tools；2→6工具；pnpm lint+test全绿（244/244） |
| Phase 37：Anthropic 原生 tool_use API | ✅ 完成 | 2026-03-05 | chatWithTools()+ApiMessage/ToolSchema/ToolUseBlock/ApiContent类型；builtin engine改用原生tool_use多轮协议（替换XML hack）；11新测试；pnpm lint+test全绿（255/255） |
| Phase 38：流式端点工具执行支持 | ✅ 完成 | 2026-03-05 | streamWithTools()真正流式Anthropic SSE+tool_use解析；runBuiltin()改用streamWithTools()实现字符级流+工具执行；/stream端点改用runBuiltin+onChunk透明工具执行；5新测试；pnpm lint+test全绿（255→260） |
| Phase 39：前端完善 — Markdown 渲染 + 设置面板 + 连接器管理 UI | ✅ 完成 | 2026-03-05 | marked.js Markdown渲染(v-html)+⚙设置面板(Models/Connectors/System三标签)+连接器CRUD UI+健康/stats展示；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（260/260） |
| Phase 40：设置面板扩展 — Agent 配置 + 记忆管理 UI | ✅ 完成 | 2026-03-05 | Agent标签(name/systemPrompt/model可编辑+PATCH保存)+Memories标签(列表+搜索+单条删除)+默认打开Agent标签；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（260/260） |
| Phase 41：Scheduler UI + Workstyle 文档 UI | ✅ 完成 | 2026-03-05 | Scheduler标签(任务列表+创建+toggle+删除)+ Agent标签新增WorkStyle文档编辑区(GET+PUT /api/context/workstyle)；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（260/260） |
| Phase 42：LLM 用量仪表板 UI + 管理员备份/恢复 UI | ✅ 完成 | 2026-03-05 | Usage标签(Summary+Budget进度条+7日日报+预算设置)+Admin标签(手动备份+更新检查+导出ZIP/JSON/MD+从ZIP恢复)；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（260/260） |
| Phase 43：Session 管理 UI — 重命名/删除会话 | ✅ 完成 | 2026-03-05 | hover菜单(✏rename+×delete)；inline input编辑(Enter保存/Esc取消/blur取消)；级联删除自动切换session；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（260/260） |
| Phase 44：Model Switcher UI | ✅ 完成 | 2026-03-05 | PUT /api/models/active(process.env mutation+validate)；Models标签新增provider下拉+model下拉/输入+Apply按钮+即时提示；3新测试；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（263/263） |
| Phase 45：键盘快捷键 | ✅ 完成 | 2026-03-05 | globalKeydown(Cmd+N新建会话/Cmd+/开关设置/Esc关闭)；onMounted注册+onUnmounted移除；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（263/263） |
| Phase 46：Onboarding Flow UI | ✅ 完成 | 2026-03-05 | 4步向导覆盖层(welcome/setup_agent/add_connector/workstyle_doc)；checkOnboarding启动检测；步骤指示器；skip支持；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（263/263） |
| Phase 47：Toast 通知系统 | ✅ 完成 | 2026-03-05 | toast(msg, type) 全局通知函数；右下角堆叠容器+2.5s自动消失；替换所有alert()+inline msg span；apps/jowork+apps/fluxvita均更新；pnpm lint+test全绿（263/263） |
| FluxVita master | 🔄 持续迭代 | - | 与 Jowork 迁移并行，不受 monorepo-migration 影响 |

*当前版本：fluxvita-allinone 单体，持续在 master 上迭代。Monorepo 迁移在专用分支，不影响 FluxVita 日常开发。*

---

### 0.8 当前代码基线（2026-03-04）

> 本小节用于把“计划”与“现实代码状态”对齐。每次进入新 Phase 前，先更新这张表。

| 维度 | 当前状态 | 说明 |
|------|---------|------|
| API 路由规模 | ~128 条 | 已具备完整业务骨架（认证、Agent、连接器、调度、管理端） |
| 连接器 | 7 个 | Feishu/GitLab/Linear/PostHog/Figma/Email/OSS 均可 discover+fetch |
| Agent | 已双引擎 | builtin + claude-agent，并有 MCP/Skills 集成 |
| 桌面端 | 已上线 | Tauri + 本地代理 + 离线页 + 托盘 + 自动更新 |
| 关键阻塞 1 | `npm run lint` 未通过 | 角色迁移未收敛（新旧角色混用） |
| 关键阻塞 2 | `cargo check` 未通过 | `src-tauri` WebSocket sink trait 缺失 |
| 关键阻塞 3 | `npm test` 1 项失败 | 一次性脚本被测试入口误执行 |

**规则**：上述 3 个阻塞未清零时，不进入架构迁移（Phase 0+），优先稳定化。

---

### 0.9 RBAC 统一目标（迁移冻结约束）

当前项目正在从旧角色集合迁移到新角色集合。为避免“边迁移边扩散”：

- 目标角色（唯一合法）：`owner` / `admin` / `member` / `guest`
- 兼容映射（仅迁移窗口期允许）：
  - `super_admin` -> `owner`
  - `developer` / `product` / `operations` / `designer` -> `member`
  - `viewer` -> `guest`
- 迁移窗口期约束：
  - 允许在 `middleware` 层做兼容映射
  - 禁止在新代码中新增旧角色字面量
  - Connector ACL、测试数据、默认值一律使用新角色

当旧角色引用数降到 0 后，删除兼容映射逻辑并标记为“RBAC v2 收敛完成”。

---

### 0.10 Phase 级硬性闸门（DoD）

每个 Phase “完成”前，必须同时满足：

1. `npm run lint` 通过
2. `npm test` 通过（以当时用例总数为准，不允许已知失败用例挂起）
3. `cd src-tauri && cargo check` 通过（如该 Phase 未涉及 Tauri，也需回归确认）
4. 无 `TODO: fix later` 留在主干功能路径
5. 文档更新：本节 `0.7` 状态表 + 对应 Phase 勾选同步更新

任一项不满足，Phase 状态只能标记“进行中”，不得标记“完成”。

---

## 一、品牌体系

### Jo 系列产品家族

| 产品 | 全称 | 含义 | 定位 |
|------|------|------|------|
| **Jovida** | Joy of Vida | Agent for Life | 个人生活教练 App（面向海外 C 端） |
| **Jowork** | Joy of Work | Agent for Work | AI 同事平台（个人/团队，开源） |

**Jo = Joy**，核心理念：让 AI 让工作和生活都更 joyful。
两个产品共享品牌基因，但独立运营、独立仓库。

### 开源身份

- **GitHub 组织**: `fluxvita`（新建，统一品牌）
- **仓库地址**: `github.com/fluxvita/jowork`
- **开源协议**: AGPL-3.0（核心）+ 商业协议（Premium）
- **slogan**: _"Your AI coworker that actually knows your business."_

---

## 二、产品定义

### 2.1 一句话定位

> Jowork 是一个 **24 小时在线的 AI 同事**——持续连接你的所有数据源和工作流，既能被动回答问题，也能主动执行任务。不是工具，是同事。

### 2.2 核心差异化

与现有产品的本质区别：

| 维度 | ChatGPT / Notion AI | Dust.tt / Glean | **Jowork** |
|------|---------------------|-----------------|------------|
| 上下文 | 无业务上下文 | 有，但只读 | **深度连接 + 可写可操作** |
| 主动性 | 被动问答 | 被动问答 | **定时 + 事件触发 + 目标驱动** |
| 部署 | SaaS only | SaaS only | **自部署（本地/私有服务器）** |
| 执行力 | 只能对话 | 只能查数据 | **Claude Code 级别的执行力** |
| 个性化 | 无 | 基本 | **三层上下文 + 工作方式文档** |

### 2.3 目标用户

**Phase 1 核心用户**（开源冷启动）：
- 独立开发者 / 技术 Founder（有自部署能力，愿意折腾，社区传播力强）
- 小团队 CTO（3-20 人团队，想给团队装一个 AI 助手）

**Phase 2 拓展用户**（商业化阶段）：
- 知识工作者（设计师、PM、分析师，通过 Onboarding 降低使用门槛）
- 中型公司技术团队（50-200 人，需要权限管理和合规）

### 2.4 部署模式

| 模式 | 场景 | 架构 |
|------|------|------|
| **Personal** | 个人开发者，全部跑在自己电脑 | 单进程，本地 SQLite，无认证 |
| **Team** | 小公司，一台服务器 + 多个员工客户端 | 中心 Gateway + Tauri 客户端，JWT 认证 |
| **Enterprise**（远期） | 中型公司，多部门 | Team 模式 + SSO + 审计日志 + 合规 |

Personal 和 Team 是 v1 必须支持的。Enterprise 是 v2+。

---

## 三、核心设计

### 3.1 Agent 架构

```
单 Agent 实例
├── 多 Session（不同任务/对话各一个 Session）
├── 每个 Session 有独立的上下文窗口
└── 复杂任务时，Agent 自动或用户手动触发 Sub-agent
    ├── Sub-agent 处理子任务
    ├── 结果汇总回主 Agent
    └── Sub-agent 用完即销毁
```

**设计原则**：
- 默认单 Agent，够用就不引入复杂度
- Sub-agent 仅在上下文溢出或用户明确要求时创建
- Session 间相互隔离，但共享用户记忆库和数据源

### 3.2 三层上下文体系

这是 Jowork 最核心的设计之一，决定了 Agent「懂你」的程度。

```
┌──────────────────────────────────────┐
│  公司层 (Company Context)             │  ← 管理员维护，强制生效
│  - 公司使命、产品方向                    │
│  - 合规要求、禁止事项                    │
│  - 全局工具/数据源配置                   │
├──────────────────────────────────────┤
│  部门层 (Team Context)                │  ← 团队 Lead 维护，默认生效
│  - 团队工作方式、协作规范                 │
│  - 共享知识库                           │
│  - 团队专属工具/数据源                   │
├──────────────────────────────────────┤
│  个人层 (Personal Context)            │  ← 员工自己维护 + Agent 自动更新
│  - 我的工作方式、习惯偏好                 │
│  - 当前优先级和任务                      │
│  - 个人技能背景                         │
│  - Agent 人格设定                       │
└──────────────────────────────────────┘
```

**优先级规则**：公司层 > 部门层 > 个人层

- 公司层可以 **强制附加** 要求到所有员工的 Agent 上（例如「不得在对话中泄露客户数据」）
- 部门层对团队成员默认生效，个人可覆盖（除非部门设为强制）
- 个人层完全自主，Agent 人格由员工自定义

**Personal 模式下**：只有个人层，没有公司/部门层。

**上下文加载策略**（关键技术问题）：
- 不能把三层全部塞进 system prompt（会爆上下文）
- 需要 **按需加载**：根据当前对话主题，动态选择相关的上下文片段
- 使用语义搜索从三层文档中提取最相关的 N 条
- 公司层的「强制规则」始终加载，其余按相关性排序

### 3.3 工作方式文档

类似当前项目的「我的工作方式」功能，但更系统化：

**文档类型**：
| 类型 | 创建者 | 示例 |
|------|--------|------|
| 公司手册 | 管理员 | 「我们是做 XX 的公司，核心产品是...」 |
| 团队规范 | Lead | 「代码审查流程、发布 checklist」 |
| 个人方式 | 员工/Agent | 「我喜欢先看数据再做决策」 |
| Agent 自学习 | Agent | 「Aiden 通常 10:30 开早会，偏好简洁沟通」 |

**Onboarding 阶段引导填写**：
- 新用户注册后，引导创建个人工作方式文档
- 团队模式下，管理员先填公司层，员工再填个人层
- Agent 在日常对话中持续学习，自动更新（经用户确认）

### 3.4 主动工作机制

参考 OpenClaw 的提醒模型，三个层级：

| 层级 | 触发方式 | 示例 | 版本 |
|------|---------|------|------|
| **定时巡逻** | Cron 表达式 / 自然语言 | 「每天 9 点汇总昨天的 MR」 | Free |
| **事件触发** | Webhook / Connector 推送 | 「有人提了 P0 Bug → 自动分析」 | Premium |
| **目标驱动** | Agent 自主判断 | 「盯着竞品动态，重要信息主动通知」 | Premium |

**定时巡逻**是 Free 用户也能用的核心能力，这是 Jowork 区别于普通 AI 聊天工具的关键体验。

---

## 四、商业模式

### 4.1 Open Core 策略

```
┌─────────────────────────────────────────────┐
│              Jowork (AGPL-3.0)               │
│                                              │
│  全部 Connector    基础 Agent 引擎            │
│  三层上下文系统     工作方式文档               │
│  定时主动工作       基础记忆库                 │
│  SQLite 数据层      7 角色 RBAC               │
│  Tauri 桌面客户端   SPA 前端                  │
│                                              │
├─────────────────────────────────────────────┤
│          Jowork Premium (商业协议)            │
│                                              │
│  Claude Agent SDK 引擎     极客模式终端        │
│  Sub-agent 编排            向量语义记忆        │
│  事件触发 + 目标驱动        高级模型路由        │
│  数据源上限提升             团队人数上限提升     │
│  Klaude 管理器             高级 Skills        │
│                                              │
└─────────────────────────────────────────────┘
```

**核心原则**：开源版必须是完整可用的产品，不是阉割版。Personal 用户用 Free 就能满足日常需要。Premium 解决的是「更强、更多、更智能」的需求。

### 4.2 功能边界明细

| 功能维度 | Free | Premium |
|---------|------|---------|
| **部署模式** | Personal + Team | Personal + Team + Enterprise |
| **用户数** | 1 人（Personal）/ 5 人（Team） | 按档位（20 / 50 / 200） |
| **数据源连接** | 全部 Connector，最多 5 个实例 | 无限 |
| **Agent 引擎** | Builtin Engine（25 轮） | + Claude Agent SDK Engine |
| **Sub-agent** | 不支持 | 支持（自动 + 手动） |
| **极客模式** | 不支持 | 支持（终端直操作） |
| **记忆搜索** | 关键词（LIKE） | + 向量语义搜索 |
| **主动工作** | 定时巡逻 | + 事件触发 + 目标驱动 |
| **模型支持** | 用户自带 API Key | + Klaude 托管 + 多模型路由 |
| **MCP / Skills** | 基础（3 个） | 无限 |
| **上下文窗口** | 32K tokens | 100K tokens |
| **工作方式文档** | 个人层 | 三层全部 |
| **审计日志** | 不支持 | 90 天保留 |
| **权限管理** | 基础（admin / user） | 7 角色完整 RBAC |

### 4.3 License 策略

| 组件 | License | 说明 |
|------|---------|------|
| `packages/core` | AGPL-3.0 | 所有人可用、可修改，但修改后的版本必须开源 |
| `packages/premium` | 商业协议 | 订阅后可用，**代码公开**（可审计），但未订阅不可商用 |
| `apps/jowork` | AGPL-3.0 | 开源版入口 |
| `apps/fluxvita` | 私有 | FluxVita 公司内部使用 |

**选 AGPL 的原因**：
- 防止大公司 fork 后闭源使用（AGPL 的网络使用条款覆盖 SaaS 场景）
- 个人/小公司自用完全自由
- 想要闭源商用 → 购买商业 License（额外收入来源）

### 4.4 订阅定价（初步，后续根据市场调整）

| 档位 | 价格 | 核心权益 |
|------|------|---------|
| **Free** | $0 | 个人使用，5 数据源，基础 Agent |
| **Pro** | $19/月 | 个人增强，无限数据源，全部 Premium 功能 |
| **Team** | $12/人/月 | 20 人以内，三层上下文，团队管理 |
| **Enterprise** | 联系销售 | SSO、审计、自定义部署、SLA |

---

## 五、技术架构

### 5.1 Monorepo 结构

```
fluxvita-allinone/              ← GitLab 私有仓库（主开发仓库）
│
├── packages/
│   ├── core/                   ← @jowork/core (AGPL-3.0)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── connectors/     ← 全部 7 个 Connector + base + registry
│   │       ├── datamap/        ← SQLite 层（db, objects, content-store, init）
│   │       ├── agent/          ← Builtin Engine + 基础工具集
│   │       │   ├── controller.ts
│   │       │   ├── session.ts
│   │       │   ├── context.ts    (32K 窗口版)
│   │       │   ├── engines/
│   │       │   │   └── builtin.ts
│   │       │   └── tools/        (基础工具：search/fetch/list/query/memory)
│   │       ├── models/         ← 基础模型路由（用户自带 Key）
│   │       ├── auth/           ← JWT + 基础 RBAC (admin/user)
│   │       ├── policy/         ← 基础权限引擎
│   │       ├── memory/         ← 基础记忆库（LIKE 搜索，无向量）
│   │       ├── scheduler/      ← Cron 调度器（定时巡逻）
│   │       ├── gateway/        ← Express 核心 + middleware + 基础路由
│   │       ├── channels/       ← 通知渠道（Web）
│   │       ├── onboarding/     ← 引导流程
│   │       ├── services/       ← 服务注册中心
│   │       ├── utils/          ← 通用工具
│   │       ├── config.ts       ← 配置管理
│   │       └── types.ts        ← 全局类型
│   │
│   └── premium/                ← @jowork/premium (商业协议，不同步到 GitHub)
│       ├── package.json
│       └── src/
│           ├── agent/
│           │   ├── engines/
│           │   │   ├── claude-agent.ts    ← Claude Agent SDK 引擎
│           │   │   └── dispatcher.ts      ← 引擎选择（含 Premium 引擎）
│           │   ├── sub-agent.ts           ← Sub-agent 编排
│           │   └── tools/                 ← 高级工具 (run_command, manage_workspace, query_posthog, query_oss)
│           ├── memory/
│           │   └── embedding.ts           ← 向量语义搜索 (Moonshot embedding)
│           ├── terminal/
│           │   └── geek-mode.ts           ← 极客模式 (node-pty)
│           ├── ai-services/
│           │   └── klaude-manager.ts      ← Klaude 生命周期管理
│           ├── skills/
│           │   └── executor.ts            ← 高级 Skill 执行器
│           ├── alerts/
│           │   └── engine.ts              ← 事件触发 + 目标驱动
│           ├── context/
│           │   └── advanced.ts            ← 100K 窗口 + 分段读取
│           └── edition.ts                 ← Premium 功能注册入口
│
├── apps/
│   ├── jowork/                 ← 开源版应用（同步到 GitHub）
│   │   ├── package.json
│   │   ├── src/
│   │   │   ├── index.ts        ← 启动入口（仅加载 core）
│   │   │   └── gateway/
│   │   │       └── routes/     ← 开源版路由（基于 core）
│   │   ├── public/             ← 开源版前端 SPA
│   │   ├── src-tauri/          ← Tauri 桌面客户端
│   │   ├── tauri-ui/
│   │   ├── README.md
│   │   ├── LICENSE             ← AGPL-3.0
│   │   └── CHANGELOG.md
│   │
│   └── fluxvita/               ← FluxVita 内部版（不同步到 GitHub）
│       ├── package.json
│       ├── src/
│       │   ├── index.ts        ← 启动入口（加载 core + premium）
│       │   └── gateway/
│       │       └── routes/     ← 完整路由（含 Premium 功能）
│       ├── public/             ← FluxVita 品牌前端
│       ├── src-tauri/          ← FluxVita 品牌 Tauri 客户端
│       └── .env.example
│
├── pnpm-workspace.yaml         ← pnpm workspaces 配置
├── package.json                ← 根 package.json
├── tsconfig.base.json          ← 共享 TypeScript 配置
├── .gitlab-ci.yml              ← CI/CD（两个 app 分别构建）
├── scripts/
│   └── sync-to-github.sh       ← 手动打 tag 后同步到 GitHub 的脚本
├── docs/
│   └── JOWORK-PLAN.md          ← 本文档
└── CLAUDE.md
```

### 5.2 包依赖关系

```
@jowork/core          ← 零内部依赖，独立可用
     ↑
@jowork/premium       ← 依赖 core，扩展其能力
     ↑
apps/jowork           ← 仅依赖 core
apps/fluxvita         ← 依赖 core + premium
```

### 5.3 Edition 功能门控机制

在 `packages/core` 中定义扩展点接口，`packages/premium` 注册实现：

```typescript
// packages/core/src/edition.ts
export interface EditionFeatures {
  maxDataSources: number;
  maxUsers: number;
  maxContextTokens: number;
  agentEngines: string[];          // ['builtin'] for free
  hasVectorMemory: boolean;
  hasGeekMode: boolean;
  hasSubAgent: boolean;
  hasEventTrigger: boolean;
  hasGoalDriven: boolean;
  hasAdvancedRBAC: boolean;
  hasAuditLog: boolean;
}

// 默认 Free 版配置
export const FREE_EDITION: EditionFeatures = {
  maxDataSources: 5,
  maxUsers: 5,
  maxContextTokens: 32_000,
  agentEngines: ['builtin'],
  hasVectorMemory: false,
  hasGeekMode: false,
  hasSubAgent: false,
  hasEventTrigger: false,
  hasGoalDriven: false,
  hasAdvancedRBAC: false,
  hasAuditLog: false,
};

// Premium 通过注册覆盖
let currentEdition: EditionFeatures = { ...FREE_EDITION };
export function registerEdition(features: Partial<EditionFeatures>) {
  currentEdition = { ...currentEdition, ...features };
}
export function getEdition(): EditionFeatures {
  return currentEdition;
}
```

```typescript
// packages/premium/src/edition.ts
import { registerEdition } from '@jowork/core';

export function activatePremium(licenseKey: string) {
  // 验证 license...
  registerEdition({
    maxDataSources: Infinity,
    maxUsers: 200,
    maxContextTokens: 100_000,
    agentEngines: ['builtin', 'claude-agent-sdk'],
    hasVectorMemory: true,
    hasGeekMode: true,
    hasSubAgent: true,
    hasEventTrigger: true,
    hasGoalDriven: true,
    hasAdvancedRBAC: true,
    hasAuditLog: true,
  });
}
```

### 5.4 GitHub 同步机制

**触发方式**：手动打 tag（格式 `jowork-v*`）

**同步范围**：
```
GitLab                          →  GitHub (fluxvita/jowork)
packages/core/                  →  packages/core/
apps/jowork/                    →  （展开为仓库根目录结构）
docs/ (选择性)                   →  docs/
scripts/sync-to-github.sh      →  不同步
packages/premium/               →  不同步
apps/fluxvita/                  →  不同步
```

**sync-to-github.sh 核心逻辑**：
```bash
#!/bin/bash
# 1. 检出 tag 对应的 commit
# 2. 用 rsync 组装 GitHub 仓库结构
#    - packages/core/ → packages/core/
#    - apps/jowork/*  → 根目录（src/, public/, src-tauri/ 等）
# 3. 复制 LICENSE, README.md
# 4. git commit + git push 到 GitHub
```

**GitHub 仓库最终结构**（用户看到的）：
```
jowork/
├── packages/
│   └── core/               ← @jowork/core 源码
├── src/                    ← 从 apps/jowork/src/ 映射
├── public/                 ← 从 apps/jowork/public/ 映射
├── src-tauri/              ← 从 apps/jowork/src-tauri/ 映射
├── package.json            ← apps/jowork/package.json
├── tsconfig.json
├── README.md
├── LICENSE                 ← AGPL-3.0
├── CHANGELOG.md
└── docs/
```

### 5.5 CI/CD 设计

```yaml
# .gitlab-ci.yml（简化）

# 开源版构建
build:jowork:
  stage: build
  script:
    - pnpm --filter @jowork/core build
    - pnpm --filter jowork build
  rules:
    - changes: ["packages/core/**", "apps/jowork/**"]

# FluxVita 内部版构建 + 部署
build:fluxvita:
  stage: build
  script:
    - pnpm --filter @jowork/core build
    - pnpm --filter @jowork/premium build
    - pnpm --filter fluxvita build
  rules:
    - changes: ["packages/**", "apps/fluxvita/**"]

deploy:fluxvita:
  stage: deploy
  script:
    - # Mac mini 部署流程（现有逻辑）
  tags: [macos, deploy]
  rules:
    - if: $CI_COMMIT_BRANCH == "master"

# GitHub 同步（手动 tag 触发）
sync:github:
  stage: deploy
  script:
    - bash scripts/sync-to-github.sh $CI_COMMIT_TAG
  rules:
    - if: $CI_COMMIT_TAG =~ /^jowork-v/
```

---

## 六、三层上下文技术方案

这是 Jowork 最复杂也最关键的技术设计，单独一节详述。

### 6.1 存储模型

```sql
-- 上下文文档表
CREATE TABLE context_docs (
  id          TEXT PRIMARY KEY,
  layer       TEXT NOT NULL,     -- 'company' | 'team' | 'personal'
  scope_id    TEXT NOT NULL,     -- company_id | team_id | user_id
  title       TEXT NOT NULL,
  content     TEXT NOT NULL,
  doc_type    TEXT NOT NULL,     -- 'manual' | 'rule' | 'workstyle' | 'learned'
  is_forced   INTEGER DEFAULT 0, -- 1 = 强制加载，不可被下层覆盖
  created_by  TEXT NOT NULL,     -- user_id 或 'agent'
  updated_at  TEXT NOT NULL
);

-- FTS 索引
CREATE VIRTUAL TABLE context_docs_fts USING fts5(
  title, content, content='context_docs', content_rowid='rowid'
);
```

### 6.2 上下文组装流程

```
用户发送消息
  ↓
1. 始终加载：公司层 is_forced=1 的文档（合规规则、禁止事项）
   ← 控制在 ~2K tokens 以内
  ↓
2. 语义匹配：根据用户消息，从三层文档中搜索最相关的 Top-N
   ← Free: 关键词匹配 (FTS5)
   ← Premium: 向量语义搜索 + FTS5 混合
   ← 控制在 ~4K tokens 以内
  ↓
3. 个人工作方式：始终加载用户的「我的工作方式」文档
   ← 控制在 ~1K tokens 以内
  ↓
4. Agent 人格：加载用户设定的 Agent 人格描述
   ← 控制在 ~500 tokens
  ↓
组装成 system prompt（总计 ~8K tokens 上下文开销）
  ↓
剩余窗口留给对话历史和工具结果
```

### 6.3 Agent 自学习流程

```
日常对话中，Agent 发现新信息
  ↓
判断：这是临时信息还是稳定偏好？
  ├─ 临时信息 → 不记录
  └─ 稳定偏好 → 生成「学习笔记」草稿
      ↓
      提示用户确认：「我发现你偏好 XX，要记住吗？」
      ├─ 确认 → 写入 context_docs（doc_type='learned'）
      └─ 拒绝 → 丢弃
```

---

## 七、迁移路线图

从当前 `fluxvita-allinone` 单体应用（21K 行）迁移到 Monorepo。

### Phase -1: 稳定化前置（必须先做，1-2 天）

**目标**：把当前代码恢复到可发布基线，再进入结构迁移。

- [x] RBAC 收敛：统一到 `owner/admin/member/guest`，清理旧角色字面量
- [x] 修复 `npm run lint` 全量通过
- [x] 修复 `npm test` 当前失败项（将一次性脚本移出测试入口）
- [x] 修复 `cargo check` 当前编译错误
- [x] 冻结主干：新增功能暂停，直到上述问题清零

### Phase 0: 基础设施搭建（1 天）

**目标**：搭建 Monorepo 骨架，不移动任何代码

- [x] 安装 pnpm，创建 `pnpm-workspace.yaml`
- [x] 创建 `packages/core/package.json`、`packages/premium/package.json`
- [x] 创建 `apps/jowork/package.json`、`apps/fluxvita/package.json`
- [x] 创建 `tsconfig.base.json`，各包继承
- [x] 验证 `pnpm install` 和 `pnpm --filter` 正常工作
- [x] **此阶段不动现有代码，只加新文件**

### Phase 1: 抽取 packages/core（2-3 天）

**目标**：把通用模块移入 core 包，保持功能不变

- [ ] 移动模块（按依赖顺序）：
  1. `utils/`、`types.ts`、`config.ts`（零依赖）
  2. `datamap/`（依赖 utils）
  3. `auth/`、`policy/`（依赖 datamap）
  4. `connectors/`（依赖 datamap + utils）
  5. `memory/`（基础版，去掉向量搜索）
  6. `models/`（基础版）
  7. `agent/`（仅 builtin engine + 基础工具）
  8. `scheduler/`（依赖 connectors）
  9. `gateway/` core（server + middleware + 基础路由）
  10. `channels/`、`services/`、`onboarding/`
- [ ] 每移一个模块，跑一次测试确保不 break
- [ ] 更新所有 import 路径为 `@jowork/core/...`

### Phase 2: 抽取 packages/premium（1-2 天）

**目标**：把高级功能移入 premium 包

- [ ] 移动模块：
  1. `agent/engines/claude-agent.ts` + `dispatcher.ts`
  2. `memory/embedding.ts`（向量搜索）
  3. `gateway/terminal.ts`（极客模式）
  4. `ai-services/klaude-manager.ts`
  5. `skills/executor.ts`（高级 Skills）
  6. `alerts/engine.ts`（事件触发）
  7. 高级工具：`run_command`、`manage_workspace`、`query_posthog`、`query_oss`
- [ ] 实现 `edition.ts` 功能门控
- [ ] Premium 包通过 `registerEdition()` 注册高级功能

### Phase 3: 构建 apps/jowork（2 天）

**目标**：创建开源版应用，仅依赖 core

- [ ] 创建 `apps/jowork/src/index.ts`（精简启动入口）
- [ ] 创建开源版路由（去掉 Premium 路由）
- [ ] 适配开源版前端（去掉极客模式 Tab、简化 Admin）
- [ ] 适配 Tauri 客户端（品牌改为 Jowork）
- [ ] 编写 README.md、CONTRIBUTING.md
- [ ] 本地测试 Personal 模式完整可用

### Phase 4: 适配 apps/fluxvita（1 天）

**目标**：当前项目成为内部版，加载 core + premium

- [ ] 创建 `apps/fluxvita/src/index.ts`（完整启动，加载 Premium）
- [ ] 迁移 FluxVita 品牌前端
- [ ] 确保飞书 OAuth、Mac mini 部署等 FluxVita 专属逻辑正常
- [ ] 全部测试通过（以当前总用例数为准）

### Phase 5: CI/CD + GitHub 同步（1 天）

- [ ] 创建 GitHub 组织 `fluxvita`
- [ ] 创建 `fluxvita/jowork` 仓库
- [ ] 编写 `scripts/sync-to-github.sh`
- [ ] 更新 `.gitlab-ci.yml`（双 app 构建 + tag 同步）
- [ ] 首次同步测试

### Phase 6: 三层上下文系统（2-3 天）

- [ ] 实现 `context_docs` 表和 FTS
- [ ] 实现上下文组装逻辑（6.2 节）
- [ ] Onboarding 流程增加「工作方式文档」引导
- [ ] 管理后台增加「上下文管理」页面
- [ ] Agent 自学习逻辑（6.3 节）

### Phase 7: 开源清理 + 安全审计（1-2 天）

**目标**：移除所有敏感信息，确保开源代码零泄露

- [ ] 执行完整敏感信息扫描（见第十二节清单）
- [ ] 替换所有硬编码凭证为环境变量
- [ ] 替换所有品牌字符串为可配置项
- [ ] 创建 `.env.example` 模板
- [ ] 创建 `.gitignore`（排除 .env、data/、logs/）
- [ ] 运行 `git-secrets` 或 `trufflehog` 做最终扫描

### Phase 8: 扩展性重构（3-4 天）

**目标**：Connector / Channel / Model Provider 插件化

- [ ] 实现 Jowork Connect Protocol（见第九节）
- [ ] 实现 Channel 插件接口（见第十节）
- [ ] Model Provider 动态注册（去掉硬编码）
- [ ] 为开源版增加通用 Connector：GitHub Issues、Slack、Notion（至少 2 个）
- [ ] 为开源版增加通用 Channel：Telegram、Discord（至少 1 个）

### Phase 9: 平台兼容 + 国际化 + Docker（2-3 天）

- [ ] Windows 兼容性测试和修复（见第八节）
- [ ] i18n 框架搭建 + 英文翻译（见第十一节）
- [ ] Docker + docker-compose 一键部署
- [ ] 编写开源版安装/使用文档

### Phase 10: 首次公开发布（1 天）

- [ ] 创建 GitHub 组织 `fluxvita`
- [ ] 首次同步到 `fluxvita/jowork`
- [ ] 编写 README（英文为主）、CONTRIBUTING.md、CODE_OF_CONDUCT.md
- [ ] 创建 GitHub Discussions（社区沟通）
- [ ] 发布 v0.1.0 Release

### 7.11 v0.1 / v0.2 范围切分（防止范围失控）

| 范围 | 必须完成（MUST） | 可延后（SHOULD/LATER） |
|------|------------------|------------------------|
| v0.1（首次可发布） | Phase -1 ~ Phase 7 | Phase 8+（插件市场、大规模扩展、复杂商业化） |
| v0.2（能力增强） | Phase 8~10 + 关键性能优化 | 更远期功能（Marketplace、大规模企业特性） |

**执行原则**：v0.1 目标是“稳定可用 + 可开源同步”，不是一次性做完全部愿景。

**预计总工期：18-24 天**

---

## 八、平台兼容性

### 8.1 目标平台

| 平台 | 优先级 | 状态 |
|------|--------|------|
| macOS (ARM) | P0 | 已支持（当前开发环境） |
| macOS (Intel) | P0 | Tauri 可交叉编译 |
| Windows 10/11 | P0 | 需要适配 |
| Linux (Ubuntu/Debian) | P1 | 服务端部署场景 |

### 8.2 Windows 适配要点

| 问题 | 当前状态 | 解决方案 |
|------|---------|---------|
| `node-pty` | macOS prebuilt | 需 Windows prebuilt 或编译 |
| `launchctl` | macOS 特有 | Windows 用 `pm2` 或 Windows Service |
| 路径分隔符 | 部分硬编码 `/` | 统一用 `path.join()` / `path.resolve()` |
| 文件权限 | `chmod` 调用 | 条件判断 `process.platform` |
| SQLite native | macOS ARM prebuilt | better-sqlite3 有 Windows prebuilt |
| Tauri 打包 | DMG | 改为 NSIS/MSI（Tauri 内置支持） |
| 自签名证书 | `openssl` CLI | 用 Node.js `crypto` 模块替代 |

### 8.3 跨平台抽象层

```typescript
// packages/core/src/platform.ts
export const platform = {
  isWindows: process.platform === 'win32',
  isMac: process.platform === 'darwin',
  isLinux: process.platform === 'linux',

  dataDir(): string {
    // Windows: %APPDATA%/jowork
    // macOS: ~/Library/Application Support/jowork
    // Linux: ~/.config/jowork
  },

  logDir(): string { ... },

  // 进程管理抽象
  daemonize(script: string): Promise<void> {
    // macOS: launchctl
    // Windows: node-windows service
    // Linux: systemd unit
  }
};
```

---

## 九、通用连接协议 (Jowork Connect Protocol, JCP)

这是 Jowork 数据源扩展性的核心设计。目标：**像 MCP 一样可以无限扩展，第三方按标准协议接入，用户尽量零配置。**

### 9.1 设计原则

1. **OAuth 优先**：能用 OAuth/SSO 就不让用户手动填 Token
2. **MCP 兼容**：已有 MCP Server 的服务直接桥接，不重复造轮子
3. **第三方可开发**：Connector 是标准 npm 包，社区可贡献
4. **热加载**：安装/卸载 Connector 不需重启服务

### 9.2 Connector Manifest

每个 Connector 是一个 npm 包，包含 `jowork-connector.json`：

```json
{
  "id": "github",
  "name": "GitHub",
  "version": "1.0.0",
  "description": "Connect to GitHub repositories, issues, and pull requests",
  "icon": "github.svg",

  "auth": {
    "type": "oauth2",
    "authorize_url": "https://github.com/login/oauth/authorize",
    "token_url": "https://github.com/login/oauth/access_token",
    "scopes": ["repo", "read:org"],
    "docs_url": "https://docs.github.com/en/apps/oauth-apps"
  },

  "capabilities": ["discover", "fetch", "write", "subscribe"],

  "data_types": ["repository", "issue", "pull_request", "commit", "discussion"],

  "config_schema": {
    "type": "object",
    "properties": {
      "org": { "type": "string", "title": "Organization", "description": "GitHub org to connect" }
    }
  },

  "entry": "./dist/index.js"
}
```

### 9.3 认证层级（用户摩擦从低到高）

```
1. MCP 桥接     → 用户已有 MCP Server，Jowork 直接连接（零配置）
   ↓
2. OAuth / SSO  → 一键授权，Jowork 管理 token 刷新（最低摩擦）
   ↓
3. API Token    → 用户从服务商后台复制 token（中等摩擦）
   ↓
4. API Key      → 用户创建 API Key 并粘贴（较高摩擦）
   ↓
5. Manual       → 用户提供自定义连接参数（最高摩擦，兜底方案）
```

Jowork 为每种 auth type 提供标准化流程：
- `oauth2`：自动跳转授权页 → 回调 → 存储 refresh token → 自动续期
- `api_token`：UI 提供输入框 + 连接测试按钮
- `mcp`：直接复用 MCP Bridge 管理器

### 9.4 Connector 运行时接口

```typescript
// packages/core/src/connectors/protocol.ts
export interface JoworkConnector {
  // === 元数据 ===
  readonly manifest: ConnectorManifest;

  // === 生命周期 ===
  initialize(config: ConnectorConfig, credentials: EncryptedCredentials): Promise<void>;
  shutdown(): Promise<void>;
  health(): Promise<{ ok: boolean; latency_ms: number; error?: string }>;

  // === 数据发现（必须实现） ===
  discover(cursor?: string): Promise<{
    objects: DataObject[];
    next_cursor?: string;    // 增量同步
  }>;

  // === 数据获取（必须实现） ===
  fetch(uri: string): Promise<{
    content: string;
    content_type: string;
    metadata?: Record<string, any>;
  }>;

  // === 写入（可选） ===
  write?(uri: string, content: string): Promise<{ success: boolean; new_uri?: string }>;

  // === 事件订阅（可选，Premium） ===
  subscribe?(event_type: string, callback: (event: ConnectorEvent) => void): Promise<Subscription>;
}
```

### 9.5 Connector 安装流程

```
用户在 UI 中搜索 Connector
  ↓
从 npm registry 或 Jowork 官方仓库下载
  ↓
验证 manifest + 签名
  ↓
存入 data/connectors/{id}/
  ↓
展示认证 UI（OAuth 按钮 / Token 输入框）
  ↓
用户完成认证 → credentials AES-256 加密存储
  ↓
初始化 → 首次 discover() → 数据入库
  ↓
注册 Cron 任务（定期增量同步）
```

### 9.6 MCP 桥接模式

对于已有 MCP Server 的服务（很多），Jowork 提供自动桥接：

```
用户配置 MCP Server（命令 + 参数）
  ↓
Jowork MCP Bridge 启动子进程
  ↓
自动将 MCP tools 映射为 Agent 可调用的工具
  ↓
额外：尝试从 MCP resources 中 discover 数据对象
  ↓
数据对象索引到 Jowork 搜索系统
```

这样 MCP 生态的 Server 不需要任何改造就能接入 Jowork。

---

## 十、通信渠道扩展

### 10.1 渠道架构

```
                    ┌──────────────────┐
                    │   Agent Engine    │
                    └────────┬─────────┘
                             │
                    ┌────────┴─────────┐
                    │  Channel Router   │
                    └────────┬─────────┘
                             │
         ┌───────┬───────┬───┴───┬───────┬───────┐
         │       │       │       │       │       │
       Web    Feishu  Telegram Discord  Slack   CLI
      (内置)  (插件)   (插件)  (插件)  (插件)  (内置)
```

### 10.2 Channel 插件接口

```typescript
// packages/core/src/channels/protocol.ts
export interface JoworkChannel {
  readonly id: string;
  readonly name: string;

  // === 生命周期 ===
  initialize(config: ChannelConfig): Promise<void>;
  shutdown(): Promise<void>;

  // === 接收消息（从外部渠道 → Jowork） ===
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;

  // === 发送消息（从 Jowork → 外部渠道） ===
  sendText(target: ChannelTarget, text: string): Promise<void>;
  sendRichCard?(target: ChannelTarget, card: RichCard): Promise<void>;
  sendFile?(target: ChannelTarget, file: Buffer, filename: string): Promise<void>;

  // === 能力声明 ===
  capabilities: {
    richCards: boolean;      // 支持富文本卡片
    fileUpload: boolean;     // 支持文件发送
    reactions: boolean;      // 支持表情回应
    threads: boolean;        // 支持消息线程
    editMessage: boolean;    // 支持编辑已发消息
  };
}

export interface IncomingMessage {
  channel_id: string;
  sender_id: string;         // 渠道内的用户标识
  sender_name: string;
  text: string;
  attachments?: Attachment[];
  reply_to?: string;         // 线程回复
  metadata?: Record<string, any>;
}
```

### 10.3 用户身份映射

同一个人可能通过多个渠道跟 Jowork 对话，需要统一身份：

```sql
-- 渠道用户映射表
CREATE TABLE channel_user_mappings (
  channel_type    TEXT NOT NULL,    -- 'telegram' | 'discord' | 'feishu' | ...
  channel_user_id TEXT NOT NULL,    -- 渠道内的用户 ID
  jowork_user_id  TEXT NOT NULL,    -- Jowork 内部用户 ID
  verified        INTEGER DEFAULT 0,
  PRIMARY KEY (channel_type, channel_user_id)
);
```

首次通过新渠道联系 Jowork 时，需要验证身份（发送验证码到已绑定渠道）。

### 10.4 首发渠道计划

| 渠道 | 版本 | 优先级 | 说明 |
|------|------|--------|------|
| Web（桌面端 App） | 内置 | P0 | 已有，是核心交互界面 |
| CLI（终端） | 内置 | P1 | 开发者友好，类似 `jowork chat` |
| Telegram | 插件 | P1 | 全球通用，Bot API 成熟 |
| Discord | 插件 | P1 | 开发者社区首选 |
| Feishu | 插件 | P1 | 中国企业用户必备 |
| Slack | 插件 | P2 | 海外企业标配 |
| WhatsApp | 插件 | P3 | Business API 门槛较高 |
| Email | 插件 | P3 | 通过邮件与 Agent 交互 |

---

## 十一、数据安全架构

> 安全不只是技术问题——**心理安全感**同样重要。员工必须确信：我的对话、我的数据、我问 AI 的问题，老板和同事看不到。

### 11.1 数据分类（强制标记）

```
┌─────────────────────────────────────────────────────┐
│  Level 4: SECRET（绝密）                              │
│  - API 密钥、OAuth tokens、加密密钥                    │
│  - 存储：AES-256-GCM 加密，仅系统进程可访问             │
│  - 可见：仅 super_admin                               │
├─────────────────────────────────────────────────────┤
│  Level 3: RESTRICTED（受限）                          │
│  - 公司战略、财务、客户信息、薪酬                        │
│  - 存储：加密，仅授权角色可访问                          │
│  - 可见：admin + 被授权的特定人员                       │
├─────────────────────────────────────────────────────┤
│  Level 2: INTERNAL（内部）                            │
│  - 代码仓库、内部文档、项目数据                          │
│  - 存储：明文，公司员工可按权限访问                       │
│  - 可见：所有员工（按 ACL 细分）                        │
├─────────────────────────────────────────────────────┤
│  Level 1: PUBLIC（公开）                              │
│  - 公开文档、营销材料                                   │
│  - 存储：明文，所有人可访问                              │
│  - 可见：所有人                                        │
└─────────────────────────────────────────────────────┘
```

**关键改进**：所有数据对象**必须**标记 sensitivity level，未标记的默认为 `public`。
Connector 同步时根据数据源和类型**自动标记**（如：飞书私聊 → restricted，代码仓库 → internal）。

### 11.2 三道安全防线

```
第一道：数据入口防线（Connector 同步时）
  ├─ 自动标记 sensitivity level
  ├─ 自动设置 ACL（基于数据源权限映射）
  └─ 敏感模式检测（API Key / 银行卡 / 身份证 → 自动升级到 secret）

第二道：Agent 上下文防线（工具执行时）
  ├─ search_data / fetch_content → 先过 ACL 再返回
  ├─ sensitivity ceiling 检查 → 超过用户等级的数据直接拦截
  └─ 未进入上下文的数据，Agent 不可能泄露

第三道：输出防线（回复用户前）
  ├─ 正则模式匹配（手机号 / API Key / 卡号 → 脱敏）
  ├─ 跨用户泄露检查（回复中不得包含其他用户的个人信息）
  └─ 审计日志（记录每次被拦截的访问）
```

### 11.3 心理安全设计（核心差异点）

这是大多数 AI 产品忽略的维度——员工不只需要「数据安全」，更需要「心理安全感」。

**原则**：

| 场景 | 员工的担忧 | Jowork 的保证 |
|------|---------|-------------|
| 跟 AI 聊工作困惑 | 「老板会不会看到？」 | 对话内容**完全私密**，管理员不可见 |
| 搜索敏感话题 | 「HR 知道我搜了什么吗？」 | 搜索记录**不可追溯**到个人 |
| 问 AI 对领导决策的看法 | 「会不会被记录？」 | 个人会话**不纳入审计** |
| 创建个人工作方式文档 | 「其他人能看到吗？」 | 个人层文档**完全隔离** |

**技术保证**：

1. **管理员可见 vs 不可见**：
   ```
   ✅ 管理员可见：聚合使用统计（总对话数、Token 消耗、活跃用户数）
   ✅ 管理员可见：系统健康状态、Connector 状态
   ❌ 管理员不可见：任何用户的对话内容
   ❌ 管理员不可见：个人记忆库内容
   ❌ 管理员不可见：个人工作方式文档
   ❌ 管理员不可见：用户的搜索/工具调用详情
   ```

2. **审计日志范围严格限定**：
   - 只记录**系统级事件**（登录、权限变更、Connector 配置修改）
   - **不记录**用户与 Agent 的交互内容
   - 工具统计仅展示聚合数据（总调用次数/成功率），不暴露个人明细

3. **Agent 拒绝跨用户查询**：
   - 老板问「张三今天跟 AI 聊了什么？」→ Agent 直接拒绝
   - 任何试图获取其他用户会话内容的指令 → 返回「该信息受隐私保护」

### 11.4 个人数据 vs 公共数据隔离

```
┌───────────────────────────────────────────────┐
│                 Jowork Instance                 │
│                                                 │
│  ┌──────────────┐    ┌──────────────────────┐  │
│  │ 公共数据空间   │    │   个人数据空间         │  │
│  │ (Shared)      │    │   (Per-User, 加密)    │  │
│  │               │    │                       │  │
│  │ - 公司文档     │    │ - 个人记忆库           │  │
│  │ - 代码仓库     │    │ - 个人工作方式文档      │  │
│  │ - Issue 列表   │    │ - 私人对话历史         │  │
│  │ - 共享知识库   │    │ - Agent 人格设定       │  │
│  │               │    │ - 个人连接的数据源      │  │
│  └──────┬────────┘    └──────────┬────────────┘  │
│         │                        │               │
│         │    ┌───────────┐      │               │
│         └───→│ ACL 引擎  │←─────┘               │
│              │ + 敏感度   │                       │
│              │   天花板   │                       │
│              └─────┬─────┘                       │
│                    ↓                             │
│            允许/拒绝/脱敏                          │
└───────────────────────────────────────────────┘
```

### 11.5 已发现的安全缺陷及修复计划

| # | 缺陷 | 风险 | 修复方案 | 优先级 |
|---|------|------|---------|--------|
| 1 | 数据对象 sensitivity 字段非必填，未标记 = 无过滤 | 高 | 改为必填，默认 `public`，Connector 自动标记 | P0 |
| 2 | 会话摘要生成时未重新过滤敏感数据 | 高 | 归档前重新过 Context PEP，脱敏后再生成摘要 | P0 |
| 3 | 角色 sensitivity ceiling 过于粗糙（designer=developer=internal） | 中 | 细化：product/operations → restricted | P1 |
| 4 | 工具统计 API 暴露个人工具调用详情 | 中 | 改为仅聚合统计，去掉 user_name 字段 | P1 |
| 5 | session_messages.content 明文存储 | 中 | 用户级加密（user_id 派生密钥 + AES） | P2 |

### 11.6 数据驻留

| 部署模式 | 数据位置 | 加密 |
|---------|---------|------|
| Personal | 用户本机 | 本地 SQLite，可选全盘加密 |
| Team | 公司服务器 | SQLite + AES-256（credentials + 个人会话） |
| Enterprise | 客户指定 | 支持自定义存储后端（远期） |

**绝不上传数据到 Jowork 服务器**（除非用户显式选择云托管版本，这是远期计划）。

### 11.7 可验证控制点（Security Acceptance Criteria）

为避免“安全承诺无法验证”，每项承诺都绑定可测试控制点：

1. 管理员不可读用户私有内容  
   - 测试：管理员调用用户会话明细接口时，不返回 `session_messages.content`
2. 工具统计仅聚合  
   - 测试：`/api/agent/tool-stats` 不返回 `user_id` / `user_name` 级明细
3. 跨用户查询拒绝  
   - 测试：构造“查询他人对话”的提示词，返回固定拒绝语义
4. 敏感度天花板生效  
   - 测试：低权限用户无法把 `restricted/secret` 数据注入上下文
5. 审计边界可解释  
   - 测试：审计日志中不出现用户对话正文，只保留系统级事件

上线前必须产出一次安全验收报告，逐条附测试证据。

---

## 十二、国际化 (i18n)

### 12.1 范围

| 层 | 当前状态 | 目标 |
|----|---------|------|
| 后端 API 错误信息 | 中文硬编码 | 英文默认，i18n 支持 |
| 前端 UI 文本 | 中文硬编码 | 英文默认 + 中文 |
| Agent system prompt | 中文 | 跟随用户语言设置 |
| 文档 | 中文 CLAUDE.md | 英文 README + 中文翻译 |

### 12.2 技术方案

**后端**：
```typescript
// packages/core/src/i18n.ts
// 轻量方案：JSON 文件 + 简单 key-value 替换
import en from './locales/en.json';
import zh from './locales/zh.json';

const locales = { en, zh };
export function t(key: string, locale: string = 'en'): string {
  return locales[locale]?.[key] ?? locales.en[key] ?? key;
}
```

**前端**：
```javascript
// 基于 data-i18n 属性的简单方案
// <span data-i18n="nav.chat">Chat</span>
function applyI18n(locale) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = i18n[locale][el.dataset.i18n] || el.textContent;
  });
}
```

**不用复杂的 i18n 框架**，前端是纯原生 JS，保持轻量。

### 12.3 语言优先级

1. 英文（默认，开源版首选）
2. 简体中文
3. 其他语言由社区贡献

---

## 十三、开源前清理清单

### 13.1 高危：生产凭证（必须在首次同步前 100% 清除）

| 文件 | 敏感内容 | 处理 |
|------|---------|------|
| `.env` | 8 个生产 API Key/密码 | **绝不同步**，加入 .gitignore |
| `src/config.ts` | GitLab URL `gitlab.fluxvitae.com` | 改为环境变量 |
| `src/alerts/engine.ts` | Aiden Open ID `ou_f122...` | 改为环境变量 |
| `src/ai-services/klaude-manager.ts` | `frp-rug.com:49790`、`gateway.fluxvita.work` | 改为环境变量 |
| `src-tauri/tauri.conf.json` | `com.fluxvita.gateway`、GitLab 更新 URL | 改为 Jowork 品牌 |

### 13.2 中危：公司/个人标识

| 文件/范围 | 内容 | 处理 |
|---------|------|------|
| 多个源文件 | `fluxvita` 品牌名 | 替换为 `jowork` |
| 多个源文件 | `jovida_uid` | 替换为通用 `user_id` |
| HTML 文件 | `jovida-logo.png` | 替换为 Jowork logo |
| HTML 文件 | `fluxvita_token` localStorage key | 替换为 `jowork_token` |
| HTML 文件 | `yourname@fluxvita.com` 示例 | 替换为 `you@example.com` |
| `CLAUDE.md` | Tailscale IP、Mac mini 信息 | 开源版写新的 CLAUDE.md |
| `.gitlab-ci.yml` | `ci@fluxvita.com` | 替换或参数化 |
| `src/agent/tools/*.ts` | FluxVita AI Agent 署名 | 替换为 Jowork AI |

### 13.3 低危：基础设施信息

| 内容 | 处理 |
|------|------|
| SakuraFRP 隧道配置 | 仅存在于 docs/CLAUDE.md，不进开源版 |
| Cloudflare Tunnel ID | 同上 |
| Mac mini LaunchAgent 配置 | 同上 |
| 飞书 App ID `cli_a928...` | 改为环境变量 `FEISHU_APP_ID` |

### 13.4 自动化清理脚本

迁移时编写 `scripts/sanitize-for-oss.sh`：
```bash
#!/bin/bash
# 1. 扫描所有 .ts/.html/.json 文件中的敏感模式
# 2. 确认 .env 不在 git 中
# 3. 检查所有 fluxvita/jovida 品牌引用
# 4. 验证没有硬编码 IP 地址
# 5. 输出报告：pass/fail + 需手动检查的文件列表
```

---

## 十四、其他扩展性设计

### 14.1 Model Provider 插件化

当前问题：3 个 Provider（Klaude/MiniMax/Moonshot）硬编码在 `router.ts` 中。

**目标**：用户可以连接任意模型提供商（OpenAI、Gemini、Ollama 本地模型等）。

```typescript
// packages/core/src/models/provider.ts
export interface ModelProvider {
  id: string;
  name: string;
  apiFormat: 'anthropic' | 'openai';  // 两种主流 API 格式
  endpoint: string;
  models: ModelInfo[];
  authenticate(apiKey: string): Promise<boolean>;
}

// 内置 Provider 模板
export const BUILTIN_PROVIDERS = {
  openai: { endpoint: 'https://api.openai.com/v1', apiFormat: 'openai' },
  anthropic: { endpoint: 'https://api.anthropic.com', apiFormat: 'anthropic' },
  ollama: { endpoint: 'http://localhost:11434/v1', apiFormat: 'openai' },
  // 用户可通过 UI 添加自定义 Provider（OpenRouter、Azure、自建等）
};
```

### 14.2 Docker 一键部署

开源版必须支持 Docker，这是自部署用户的首选方式：

```yaml
# docker-compose.yml
services:
  jowork:
    image: ghcr.io/fluxvita/jowork:latest
    ports:
      - "9800:9800"
    volumes:
      - ./data:/app/data        # SQLite + 配置持久化
      - ./.env:/app/.env        # 环境变量
    environment:
      - JOWORK_PORT=9800
      - JOWORK_EDITION=free     # free | premium
```

**构建产物**：
- Docker 镜像（GitHub Container Registry）
- Tauri 桌面客户端（GitHub Releases：DMG/NSIS/AppImage）
- npm 包 `@jowork/core`（npm registry，供开发者集成）

### 14.3 API 版本管理

```
/api/v1/agent/chat        ← 稳定 API，不轻易改
/api/v1/connectors/...
/api/v1/auth/...

/api/internal/...         ← 内部 API，不保证兼容性
```

开源版从 v1 开始，承诺 v1 内不做 breaking change。

### 14.3.1 从 `/api/*` 迁移到 `/api/v1/*` 的兼容策略

当前现实：已有大量生产路径使用 `/api/*`。为避免一次性切断：

1. 双路由阶段（2 个版本周期）  
   - 同时提供 `/api/*` 与 `/api/v1/*`，逻辑共用同一 handler
2. 弃用提示阶段  
   - 旧路由响应头附加 `Deprecation` 与迁移说明
3. 移除阶段  
   - 在明确发布日期后移除 `/api/*`，保留 `/api/v1/*`

**规则**：新功能从即日起只允许新增在 `/api/v1/*`，不得继续扩展裸 `/api/*`。

### 14.4 Plugin Marketplace（远期）

统一的插件市场，管理 Connector / Channel / Tool / Skill 四类插件：

```
jowork-marketplace/
├── connectors/
│   ├── @jowork/connector-github
│   ├── @jowork/connector-notion
│   └── @community/connector-jira     ← 社区贡献
├── channels/
│   ├── @jowork/channel-telegram
│   └── @jowork/channel-discord
├── tools/
│   └── @jowork/tool-image-gen
└── skills/
    └── @jowork/skill-code-review
```

v1 阶段先用 npm registry，不自建 marketplace。社区大了再考虑。

### 14.5 Observability（自托管实例监控）

```typescript
// 健康检查端点（已有，需标准化）
GET /health → { status, uptime, version, connectors, db_size }

// Prometheus metrics（P2，社区需要时加）
GET /metrics → prometheus format

// 错误上报（可选，用户 opt-in）
// Sentry 或自建，开源版默认关闭
```

---

## 十五、性能架构（100 人 / Mac mini M4）

> 目标机器：Mac mini M4（10 核 CPU / 16-24GB RAM / 500GB SSD）
> 目标负载：100 名员工日常使用，峰值 30 人同时在线

### 15.1 瓶颈分析与容量规划

| 资源 | 现状 | 100 人峰值需求 | 瓶颈风险 |
|------|------|--------------|---------|
| **CPU** | 单进程 Node.js（用 1 核） | 30 并发请求 × token 计算 | **严重**：单核被打满 |
| **内存** | ~200MB 空载 | 200 会话 × 8MB = 1.6GB + 系统 | 中等：16GB 够用 |
| **连接数** | macOS 默认 ulimit 256 | 200 WS + 30 SSE + 20 HTTP = 250 | **严重**：接近上限 |
| **磁盘 I/O** | SQLite WAL 单写 | 50 写/分钟 + cron 同步峰值 | 中等：SSD 够快 |
| **网络** | 无并发控制 | 30 LLM API 调用 + 6 Connector 同步 | 中等 |
| **存储** | 无清理机制 | ~14GB/年增长 | 低：500GB 足够 |

### 15.2 核心优化方案

**P0：Node.js Cluster 多进程**
```typescript
// packages/core/src/cluster.ts
import cluster from 'node:cluster';
import os from 'node:os';

const WORKER_COUNT = Math.min(os.cpus().length - 2, 8); // M4: 8 workers, 留 2 核给系统

if (cluster.isPrimary) {
  // 主进程：管理 worker + 跑 Scheduler（cron 只需一个进程）
  for (let i = 0; i < WORKER_COUNT; i++) cluster.fork();
  startScheduler();  // 仅主进程运行 cron
} else {
  // Worker 进程：各自跑 Express Gateway
  startGateway();
}
```

- 吞吐量提升 **6-8 倍**
- SQLite 在 WAL 模式下支持多进程并发读（写仍序列化，但 busy_timeout 5s 足够）
- WebSocket 连接分散到各 worker，单 worker 连接数降到 ~30

**P0：提升文件描述符限制**
```bash
# Mac mini 启动脚本中加入
sudo launchctl limit maxfiles 65536 65536
ulimit -n 65536
```

**P1：Connector 同步错峰 + 并发限制**
```
当前（冲突）:                    优化后（错峰）:
0:00 GitLab+Linear+群消息+飞书   0:00 GitLab
                                 0:30 Linear
                                 1:00 飞书
                                 1:30 群消息
                                 2:00 Email
                                 6:00 PostHog
                                 6:30 组织架构
+ Semaphore(2): 最多 2 个 Connector 同时同步
```

**P1：用户级请求限流**
```typescript
// 每用户最多 1 req/s 对 LLM API（防止单人刷屏占满 Semaphore）
const userRateLimiter = new Map<string, number>();
function checkUserRate(userId: string): boolean {
  const last = userRateLimiter.get(userId) || 0;
  if (Date.now() - last < 1000) return false;
  userRateLimiter.set(userId, Date.now());
  return true;
}
```

**P2：会话内存管理**
- 向量嵌入按需加载 + LRU 缓存（最近 50 个用户），内存峰值降 70%
- 归档阈值调整：30 条消息 OR 30K tokens 即触发（比当前更积极）
- 已归档会话 >30 天自动清理消息体（保留 summary）

**P2：数据存储生命周期**
```
content-store 文件按日期分片：
  data/content/2026/03/04/feishu/xxx.md

自动清理策略：
  - objects 表 TTL：默认 90 天
  - content 文件：跟随 objects TTL 同步删除
  - session_messages：已归档 >30 天删除
  - 每日凌晨 3 点：PRAGMA optimize + WAL checkpoint
```

### 15.3 扩容路径

| 用户规模 | 硬件 | 关键改动 |
|---------|------|---------|
| 1-20 人 | 任意 Mac/PC | 单进程即可，开箱即用 |
| 20-100 人 | Mac mini M4 | Cluster 多进程 + ulimit + 错峰同步 |
| 100-500 人 | Mac Studio / Linux Server | SQLite → PostgreSQL，或多实例 + 负载均衡 |
| 500+ 人 | Kubernetes 集群 | 微服务拆分，水平扩展（Enterprise 远期） |

---

## 十六、网络架构

> 目标：普通公司无需任何网络知识即可使用，有域名的公司可以自定义配置。

### 16.1 jowork.work 域名规划

| 子域名 | 用途 | 类型 |
|--------|------|------|
| `jowork.work` | 官网 / 文档站 | Cloudflare Pages |
| `app.jowork.work` | SaaS 版（远期） | Cloudflare Workers |
| `tunnel.jowork.work` | Tunnel 服务入口 | Cloudflare Tunnel |
| `*.tunnel.jowork.work` | 各公司实例 `{company}.tunnel.jowork.work` | 动态子域名 |
| `api.jowork.work` | API 文档 | Cloudflare Pages |

### 16.2 三种网络模式

```
模式一：局域网直连（零配置）
┌─────────┐     ┌────────────────┐
│ 员工 PC  │────→│ Mac mini :9800 │  ← mDNS: jowork.local
│ (Tauri)  │ LAN │   (Gateway)    │
└─────────┘     └────────────────┘
适用：所有员工在同一办公室

模式二：内置 Tunnel（一键远程）
┌─────────┐     ┌──────────────────┐     ┌────────────────┐
│ 员工 PC  │────→│ *.tunnel.        │────→│ Mac mini :9800 │
│ (Tauri)  │ WAN │ jowork.work      │ CF  │   (Gateway)    │
└─────────┘     │(Cloudflare Edge) │     └────────────────┘
                └──────────────────┘
适用：有远程员工，公司无域名

模式三：自定义域名
┌─────────┐     ┌──────────────────┐     ┌────────────────┐
│ 员工 PC  │────→│ ai.mycompany.com │────→│ 公司服务器 :9800│
│ (Tauri)  │ WAN │ (公司自己的域名)   │     │   (Gateway)     │
└─────────┘     └──────────────────┘     └────────────────┘
适用：有 IT 团队的公司，需要自主控制
```

### 16.3 模式一：局域网直连（默认，零配置）

**实现**：
- Gateway 启动时自动注册 mDNS（Bonjour/Avahi）
- 局域网内设备可通过 `http://jowork.local:9800` 访问
- Tauri 客户端首次启动 → 自动扫描局域网 mDNS → 找到 Gateway → 连接

```typescript
// packages/core/src/network/mdns.ts
import { createBonjourService } from './bonjour';

export function registerMdns(port: number) {
  createBonjourService({
    name: 'Jowork Gateway',
    type: 'http',
    port,
    txt: { version: '1.0', api: '/api/v1' }
  });
}
```

**客户端自动发现流程**：
```
Tauri 启动
  ↓
1. 检查本地存储的 gateway URL（有则直接连）
  ↓
2. 无配置 → mDNS 扫描局域网（3 秒超时）
  ├─ 找到 → 自动连接，保存 URL
  └─ 未找到 → 显示手动配置页面
```

### 16.4 模式二：内置 Cloudflare Tunnel（一键远程）

**管理员操作流程**（Admin 后台一个按钮）：

```
管理员点击「开启远程访问」
  ↓
1. 自动下载 cloudflared（如未安装）
  ↓
2. 调用 Cloudflare API 创建 Tunnel
   POST https://api.cloudflare.com/client/v4/accounts/{account}/tunnels
  ↓
3. 配置 DNS：{company-slug}.tunnel.jowork.work → 新 Tunnel
  ↓
4. 启动 cloudflared 作为后台服务
  ↓
5. 完成！员工用 https://{company-slug}.tunnel.jowork.work 访问

管理员只需：
  - 输入公司名（生成 slug）
  - 点击一个按钮
无需：
  - 购买域名
  - 配置 DNS
  - 设置 HTTPS 证书
  - 做端口映射
```

**技术实现**：
- Jowork 注册 Cloudflare API Token（仅管理 tunnel.jowork.work 子域名权限）
- 每个公司实例获得一个子域名
- Cloudflare 自动提供 HTTPS 证书（Let's Encrypt）
- Free 版限 1 个 Tunnel，Premium 不限

### 16.5 模式三：自定义域名

提供文档指引，支持两种方式：

**方式 A：Cloudflare Tunnel + 自有域名**
```bash
# 公司 IT 执行
cloudflared tunnel create jowork
cloudflared tunnel route dns jowork ai.mycompany.com
# 在 Jowork Admin 后台填入自定义域名
```

**方式 B：反向代理（Nginx/Caddy）**
```nginx
# Caddy 示例（自动 HTTPS）
ai.mycompany.com {
    reverse_proxy localhost:9800
}
```

**方式 C：端口映射（最简单但安全性低）**
- 路由器转发 9800 端口
- 不推荐，但支持

### 16.6 TLS 证书策略

| 模式 | 证书来源 | 用户操作 |
|------|---------|---------|
| 局域网 | 无（HTTP 明文，内网安全） | 无 |
| 内置 Tunnel | Cloudflare 自动签发 | 无 |
| 自定义域名 + Caddy | Let's Encrypt 自动签发 | 无 |
| 自定义域名 + Nginx | 用户自行配置 | 需手动 |

### 16.7 客户端连接逻辑（Tauri）

```
Tauri 启动
  ↓
1. 读取 saved_gateway_url（用户上次的配置）
  ├─ 有 → 尝试连接，成功则进入
  └─ 无 → 进入发现流程
  ↓
2. 自动发现
  ├─ mDNS 扫描局域网（3s）
  ├─ 检查 *.tunnel.jowork.work（如果有存储的公司 slug）
  └─ 都没有 → 显示配置页面（输入 URL / 扫码连接）
  ↓
3. 连接成功 → 健康检查每 30s
  ├─ 在线 → 正常使用
  └─ 离线 → 显示离线页 + 持续重试
```

**扫码连接**（提升体验）：
- 管理员在 Gateway Admin 后台生成二维码（内含 Gateway URL + 一次性连接 token）
- 员工 Tauri 客户端扫码 → 自动配置 + 自动注册账号

---

## 十七、客户端体验架构

### 17.0 平台支持策略

**目标平台**：macOS（优先）+ Windows（同步支持，稍后验证）

| 平台 | 优先级 | 说明 |
|------|--------|------|
| **macOS（Apple Silicon）** | P0，优先 | 主力开发平台，每个版本必须完整测试 |
| **macOS（Intel）** | P0 | 同上，通用二进制（Universal Binary）打包 |
| **Windows 11/10** | P1，同步支持 | Tauri + WebView2，每个版本 CI 构建并基本验证 |
| Linux | P2，社区支持 | Docker 部署路径已覆盖，桌面 App 社区自行打包 |

**开发优先级含义**：
- P0：每次发版前在本地 macOS 完整走 QA 流程
- P1：每次发版通过 CI 构建 Windows 包，smoke test 通过即可；有 Windows 用户反馈的 bug 同等优先级修复
- P2：不主动维护，但不刻意阻断

**Tauri 跨平台编译**（P1 → 自动化）：
- macOS builds：本地或 GitHub Actions macOS runner
- Windows builds：GitHub Actions `windows-latest` runner（跨平台编译）

### 17.1 现状评估

| 组件 | 当前方案 | 体验评级 | 瓶颈 |
|------|---------|---------|------|
| 主 UI（聊天/管理） | WebView + 原生 HTML/JS | B+ | 够用，但缺少原生手感 |
| 极客终端 | xterm.js（WebView 内） | C | 渲染性能差、无 GPU 加速、字体糟糕 |
| 系统集成 | Tauri（托盘/通知/快捷键） | A- | 已经很好 |
| 离线体验 | 离线页面 + 自动重连 | B | 基本可用 |

**核心判断**：主 UI 保持 WebView 即可（聊天场景不需要 60fps），但**极客终端必须大幅升级**——这是程序员群体的核心吸引力。

### 32.2架构决策：WebView + 原生终端混合

```
┌──────────────────────────────────────────────┐
│  Tauri 主窗口 (WebView)                       │
│  ┌─────────────────────────────────────────┐ │
│  │  Chat / Admin / Dashboard / Settings    │ │
│  │  (HTML + CSS + 原生 JS, 现有架构不变)     │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  Tauri 独立窗口 (原生终端 或 增强 WebGL 终端)  │
│  ┌─────────────────────────────────────────┐ │
│  │  Geek Mode Terminal                     │ │
│  │  方案 A: xterm.js + WebGL renderer      │ │
│  │  方案 B: 嵌入 alacritty_terminal (Rust) │ │
│  └─────────────────────────────────────────┘ │
│                                              │
│  + CLI 工具 (独立二进制, 任何终端可用)          │
│  $ jowork chat "帮我查一下昨天的 MR"          │
│  $ jowork terminal                           │
└──────────────────────────────────────────────┘
```

### 32.3极客终端升级路径

**Phase 1（v0.1, 立即可做）：xterm.js 增强**
- 启用 WebGL 渲染器（`xterm-addon-webgl`），帧率从 ~15fps → 60fps
- 自定义字体支持（JetBrains Mono / Fira Code / Cascadia Code + 连字）
- 主题系统（Dracula / One Dark / Catppuccin / Solarized）
- 快捷键自定义（Ctrl+T 新 Tab，Ctrl+Shift+D 分屏）
- 工作量：2-3 天

**Phase 2（v0.3）：独立终端窗口**
- 从 WebView 主窗口中独立出来，成为 Tauri 的独立窗口
- 支持多 Tab + 分屏（类似 iTerm2 布局）
- 原生窗口管理（拖拽分离、缩放、全屏）
- 工作量：3-5 天

**Phase 3（v1.0, 远期）：Rust 原生终端**
- 嵌入 `alacritty_terminal` crate（Alacritty 的终端后端）
- GPU 加速渲染，真正的 Ghostty 级体验
- 自定义着色器效果（可选）
- 工作量：10+ 天，需要 Rust 深入开发

**推荐**：v0.1 做 Phase 1（投入产出比最高），v0.3 做 Phase 2，Phase 3 视社区需求决定。

### 32.4CLI 工具（独立于桌面端）

让用户在自己最爱的终端（Ghostty / iTerm2 / Windows Terminal）里直接用 Jowork：

```bash
# 安装
npm install -g @jowork/cli
# 或
brew install jowork

# 使用
jowork login                     # 连接 Gateway + 认证
jowork chat                      # 交互式对话
jowork ask "昨天有哪些新 PR？"    # 单次提问
jowork search "用户增长数据"      # 搜索数据源
jowork status                    # 查看 Gateway 状态

# 管道集成（程序员最爱）
git diff | jowork ask "帮我 review 这个改动"
cat error.log | jowork ask "分析这个报错"
```

CLI 是独立于 Tauri 的 npm 包，适合：
- 不想装桌面 App 的开发者
- CI/CD 集成
- SSH 远程服务器上使用
- 脚本自动化

### 32.5客户端增强项（按优先级）

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 全局快捷键唤醒 | P0 | `Cmd+Shift+J` 弹出快速对话框（类似 Spotlight/Raycast） |
| 系统通知 | P0 | Agent 主动工作完成时推送通知 |
| 剪贴板集成 | P1 | 复制内容后 Cmd+Shift+V 直接发给 Agent |
| 文件拖拽 | P1 | 拖文件到对话框 → Agent 自动分析 |
| 深色/浅色主题跟随系统 | P1 | 已有基础，需完善 |
| 多窗口 | P2 | 同时开多个对话窗口 |
| 原生菜单栏 | P2 | macOS 顶部菜单（文件/编辑/窗口） |
| Touch Bar 支持 | P3 | MacBook Pro 老款 |

---

## 十八、商业化执行方案

### 18.1 订阅模型

| 档位 | 月价 | 年价（8折） | 核心权益 | 目标用户 |
|------|------|-----------|---------|---------|
| **Free** | $0 | $0 | 个人使用，5 数据源，基础 Agent | 独立开发者，评估试用 |
| **Pro** | $19 | $182/年 | 无限数据源，全部 Premium 功能，1 人 | 重度个人用户 |
| **Team** | $12/人 | $115/人/年 | 20 人以内，三层上下文，团队管理 | 小团队 |
| **Business** | $25/人 | $240/人/年 | 100 人，SSO，审计，优先支持 | 中型公司 |
| **Enterprise** | 联系销售 | 定制 | 无限人数，自定义部署，SLA | 大公司 |

**关键设计**：
- Free → Pro 的升级动力：数据源上限（5 个很快就不够用了）+ 极客模式
- Pro → Team 的升级动力：第二个人加入时必须升级
- 年付 8 折（鼓励长期订阅，降低 churn）

### 18.2 收费渠道

| 渠道 | 覆盖市场 | 接入难度 | 手续费 |
|------|---------|---------|--------|
| **Stripe** | 全球（主力） | 低 | 2.9% + $0.30 |
| **Paddle** | 全球（备选，含税务合规） | 中 | 5% + $0.50 |
| **LemonSqueezy** | 全球（适合独立开发者产品） | 低 | 5% + $0.50 |
| **支付宝/微信** | 中国 | 中 | 0.6% |

**推荐策略**：
- Phase 1：用 **Stripe**（订阅管理成熟，企业客户信任度高）
- Phase 2：加 **Paddle**（含欧洲 VAT 合规，适合全球扩张）
- Phase 3：加支付宝/微信（中国市场需要时）

### 18.3 订阅激活流程

付费机制为**在线订阅（月付 / 年付）**，无 License Key，无离线 RSA 验证。

```
用户访问 jowork.work/pricing
  ↓
选择 Pro / Team / Business + 月付或年付
  ↓
Stripe Checkout 完成支付
  ↓
jowork.work 后端记录订阅状态（customer_id + plan + expires_at）
  ↓
用户打开 Jowork App → 登录 jowork.work 账号（首次绑定）
  ↓
App 定期向 jowork.work 验证订阅状态（每天一次，本地缓存 7 天）
  ↓
订阅有效 → Premium 功能解锁
订阅过期 → 7 天 Grace Period → 自动降级到 Free
```

**设计原则**：
- **无 License Key**：账号登录即激活，降低上手门槛
- **7 天离线缓存**：短暂断网不影响使用，兼顾隐私
- **账号绑定不绑设备**：换设备登录同一账号即迁移，不需要重新购买
- **Personal 模式**：默认无账号，引导创建 jowork.work 账号后绑定本地实例以解锁 Premium

### 18.4 试用策略

| 策略 | 设计 |
|------|------|
| Free 永久可用 | 不是试用，是真正的产品（开源版） |
| Pro 14 天试用 | 首次安装自动激活，无需信用卡 |
| Team 30 天试用 | 需要填公司信息，但无需付款 |
| 降级处理 | 试用到期 → 自动降级到 Free，数据不删除，超出限制的功能变灰 |

---

## 十九、统计与可观测性

### 19.1 设计原则

> 管理员需要看到「系统在被多少人使用、运行是否健康」，但**绝不暴露个人行为数据**。

### 19.2 Admin Dashboard 指标

**实时面板**（管理后台首页）：

```
┌──────────────────────────────────────────────────────┐
│  Jowork Dashboard                     🟢 系统在线     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  👥 当前在线    📊 今日活跃    💬 今日对话    🔧 工具调用  │
│     12 人         47 人        328 次        1,204 次  │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  在线用户趋势（最近 24 小时）                       │ │
│  │  ████▆▆▃▂▁▁▁▂▃▅▇████████▇▅▃                    │ │
│  │  0  2  4  6  8  10 12 14 16 18 20 22            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  数据源状态          模型消耗            存储使用        │
│  ✅ GitHub   健康    Haiku: $2.30      DB: 156MB      │
│  ✅ GitLab   健康    Sonnet: $0.00     Content: 2.1GB │
│  ✅ Feishu   健康    Moonshot: $1.05   Total: 2.3GB   │
│  ⚠️ Linear   延迟    ─────────────                    │
│  ✅ Email    健康    日预算: $15/$50                    │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### 19.3 指标采集架构

```typescript
// packages/core/src/metrics/collector.ts

export interface JoworkMetrics {
  // === 实时指标（内存中，WebSocket 推送到 Dashboard） ===
  online_users: number;           // 当前 WebSocket 连接数（去重 user_id）
  active_sessions: number;        // 当前活跃 Agent Session 数
  pending_requests: number;       // LLM API 等待队列深度

  // === 聚合指标（SQLite 持久化，按小时/天聚合） ===
  dau: number;                    // 日活用户（不记录是谁，只记录数量）
  daily_conversations: number;    // 日对话数
  daily_tool_calls: number;       // 日工具调用数
  daily_model_cost: number;       // 日模型消耗（美元）
  daily_tokens_used: number;      // 日 Token 消耗

  // === 系统指标 ===
  cpu_usage: number;              // CPU 使用率
  memory_usage: number;           // 内存使用量
  db_size: number;                // 数据库大小
  content_store_size: number;     // 内容存储大小
  uptime: number;                 // 运行时长
}
```

### 19.4 隐私红线（绝不采集的数据）

| 绝不采集 | 原因 |
|---------|------|
| 个人对话内容 | 隐私核心承诺 |
| 个人搜索记录 | 可推断用户意图 |
| 个人工具调用详情 | 可推断工作内容 |
| 用户 IP 地址 | 可追踪物理位置 |
| 浏览器指纹 | 不需要 |

**聚合 vs 个人的边界**：
- ✅ "今天有 47 人使用了 Jowork" → 聚合，可以
- ❌ "张三今天用了 12 次搜索" → 个人，不可以
- ✅ "search_data 工具今天被调用了 500 次" → 工具维度聚合，可以
- ❌ "张三的 search_data 调用了 30 次" → 个人×工具，不可以

### 19.5 开源版遥测（opt-in，默认关闭）

开源版需要了解用户规模，但必须尊重隐私：

```
首次安装 → 弹出提示：
  「帮助 Jowork 改进：匿名分享使用统计？」
  [是, 帮助改进]  [不, 谢谢]

如果同意，仅上报：
  - 实例 ID（随机生成，不可关联到公司/个人）
  - 版本号
  - 用户数量区间（1 / 2-5 / 6-20 / 21-100）
  - 操作系统
  - 活跃 Connector 数量

绝不上报：
  - 公司名 / 域名 / IP
  - 用户名 / 邮箱
  - 对话内容 / 数据
```

上报端点：`https://telemetry.jowork.work/ping`（Cloudflare Workers，极简）

---

## 二十、品牌视觉

### 20.1 Logo 设计方向

| 维度 | 方向 |
|------|------|
| 核心概念 | "Jo" = Joy，工作中的快乐；AI 同事的温暖感 |
| 风格 | 现代、简洁、科技感但不冰冷 |
| 与 Jovida 的关系 | 同一品牌家族，共享设计语言，但独立辨识度 |
| 颜色 | 延续 Jovida 的 lime 主色（#C8FF00）+ 深色背景 |
| 字体 | 几何无衬线（类似 Inter / General Sans） |
| 图标 | 抽象化的 "J" 或 对话气泡 + 工作元素的融合 |

### 20.2 应用场景

| 场景 | 要求 |
|------|------|
| Tauri 客户端图标 | 1024×1024 PNG + icns + ico |
| GitHub README | SVG（深/浅色适配） |
| 官网 favicon | 32×32 / 16×16 |
| Docker Hub | 256×256 |
| 系统托盘 | 22×22 模板图标（macOS 单色）|

### 20.3 执行计划

Logo 设计在 Phase 3（构建 apps/jowork）之前完成，作为品牌基础。
可选方案：使用 Jovida 设计系统 Skill 快速生成初版 → 迭代。

---

## 二十一、版本更新与数据迁移

> 自部署产品最关键的运维问题：用户装了 v0.1，怎么无痛升到 v0.2？

### 21.1 数据库迁移框架

```sql
-- data/migrations/ 目录，每个文件一个迁移
--   001_initial.sql       ← 现有全部表结构的基线快照
--   002_context_docs.sql
--   003_channel_mappings.sql

CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  name       TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

```typescript
// packages/core/src/datamap/migrator.ts
export async function runMigrations(db: Database) {
  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version)
  );
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const version = parseInt(file.split('_')[0]);
    if (applied.has(version)) continue;

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)').run(version, file);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw new Error(`Migration ${file} failed: ${err.message}`);
    }
  }
}
```

Gateway 启动时**自动**执行 `runMigrations()`，用户无需手动操作。

### 21.2 Gateway 更新方式

| 部署方式 | 更新方法 | 自动化程度 |
|---------|---------|-----------|
| Docker | `docker pull + docker-compose up -d` | 可配 Watchtower 全自动 |
| npm 全局安装 | `npm update -g @jowork/app` | 手动 |
| 源码部署 | `git pull && pnpm build && pm2 restart` | 可配 CI/CD |
| Tauri 桌面端 | 内置 Tauri Updater（检查 GitHub Releases） | 半自动（提示确认） |

**更新前自动备份**：
```bash
# 更新脚本自动执行
cp data/jowork.db "data/backups/jowork.db.pre-${NEW_VERSION}-$(date +%s)"
# 保留最近 5 份，自动清理旧备份
```

### 21.3 版本策略

| 规则 | 说明 |
|------|------|
| SemVer | `MAJOR.MINOR.PATCH`，v0.x 允许 minor 版本 breaking change |
| v1.0+ | MAJOR 才可 breaking change，MINOR 保持向后兼容 |
| 发布节奏 | PATCH 每 2 周，MINOR 每月，hotfix 随时 |
| 变更日志 | 每版必更新 CHANGELOG.md（Keep a Changelog 格式） |
| 发布通道 | `latest`（稳定）/ `next`（预览）/ `canary`（每日构建） |

### 21.4 Breaking Change 处理

```
发现需要 breaking change
  ↓
1. 当前 MINOR 版本加 deprecation warning（控制台 + Admin UI 黄条）
  ↓
2. 至少保留 1 个 MINOR 版本兼容期
  ↓
3. 下一个 MAJOR 版本正式移除
  ↓
4. 提供迁移脚本 `npx @jowork/migrate v1-to-v2`
```

### 21.5 回滚能力

```bash
# Docker 回滚：指定旧版本号
docker pull ghcr.io/fluxvita/jowork:0.2.1
docker-compose up -d

# 数据库回滚：从更新前自动备份恢复
cp data/backups/jowork.db.pre-0.3.0-1741234567 data/jowork.db
# 重启旧版本 Gateway
```

Tauri 客户端无状态，不需要回滚——只需 Gateway 回滚。

---

## 二十二、法律基础设施

### 22.1 必需文档清单

| 文档 | 何时需要 | 托管位置 |
|------|---------|---------|
| **Terms of Service** | 首个付费用户前 | `jowork.work/terms` |
| **Privacy Policy** | 首次公开发布前 | `jowork.work/privacy` |
| **Contributor License Agreement (CLA)** | 接受首个外部 PR 前 | GitHub CLA bot |
| **AGPL-3.0 合规 FAQ** | README 中 | `docs/AGPL-FAQ.md` |
| **Data Processing Agreement (DPA)** | 首个 Enterprise 客户前 | 按需提供 |
| **Acceptable Use Policy** | Tunnel 服务上线前 | `jowork.work/aup` |
| **Refund Policy** | 开始收费前 | `jowork.work/refund` |

### 22.2 Privacy Policy 核心条款

**自部署实例**（关键卖点）：
- Jowork 不收集、不存储、不传输任何用户数据
- 数据 100% 留在用户自己的服务器上
- 遥测数据 opt-in，严格匿名（见 19.5 节）

**Tunnel 服务**：
- Cloudflare 作为网络中间层，其 Privacy Policy 适用
- Jowork 仅存储 Tunnel 配置元数据（公司 slug、创建时间）
- 不记录、不审查通过 Tunnel 传输的内容

**jowork.work 官网**：
- Cloudflare Analytics（无 cookie，天然 GDPR 合规）
- 支付信息由 LemonSqueezy/Stripe 处理（PCI DSS 合规）

### 22.3 GDPR / CCPA 合规

| 要求 | 自部署实例 | Tunnel 服务 | 官网 |
|------|-----------|------------|------|
| 数据控制者 | 用户自己 | FluxVita | FluxVita |
| 数据处理者 | N/A（纯本地） | Cloudflare | Cloudflare, LemonSqueezy |
| 数据删除权 | 用户自行控制 | 删除 Tunnel 即可 | 邮件申请 |
| 数据导出权 | 内置导出功能 | N/A | 邮件申请 |
| 同意机制 | 遥测 opt-in | 注册时同意 | Cookie banner（如需） |

### 22.4 CLA 策略

采用 **CLA Assistant**（GitHub App），所有外部 PR 自动要求签署：

> 你保留对贡献代码的版权，但授予 FluxVita 在 AGPL-3.0 和商业协议下分发的永久许可。

**为什么必须有 CLA**：没有 CLA，社区贡献的代码只能在 AGPL 下使用，无法纳入 Premium 包的通用改进中。

### 22.5 AGPL 合规说明（README FAQ）

| 场景 | 是否需要开源 |
|------|------------|
| 公司内部自用（不对外提供服务） | **不需要** |
| 基于 Jowork 对外提供 SaaS 服务 | **需要**（AGPL 网络使用条款） |
| 嵌入商业产品分发 | **需要**（或购买商业 License） |
| 单纯安装使用，不修改代码 | **不需要** |
| 修改代码但仅内部使用 | **不需要** |

---

## 二十三、付费用户完整旅程

### 23.1 转化漏斗

```
发现 Jowork（GitHub / 社区 / 搜索 / 口碑）
  ↓
jowork.work → Pricing 页面 → 下载 Free 版
  ↓
部署 → 体验核心功能 → 连接 3-5 个数据源
  ↓
撞到 Free 限制（第 6 个数据源 / 32K 上下文 / 无极客模式）
  ↓
Admin UI 内「升级到 Pro — $19/月」提示
  ↓
跳转 jowork.work/checkout?plan=pro → LemonSqueezy 收银台
  ↓
付款 → 账号订阅状态更新 → 重新登录 App 或等待自动同步 → 立即解锁
```

### 23.2 升级触发点

| 触发场景 | UI 表现 | 目标档位 |
|---------|---------|---------|
| 添加第 6 个数据源 | 弹窗：「Free 最多 5 个数据源」+ 升级按钮 | Pro |
| 点击极客模式 Tab | Tab 显示锁标记 + 「Pro 专属」 | Pro |
| Agent 返回「上下文不足」 | 侧边提示：「Pro 支持 100K 上下文」 | Pro |
| 第 2 个用户注册（Personal 模式） | 引导页：「升级到 Team 支持多人」 | Team |
| 第 6 个用户注册（Team 5 人） | Admin 通知：「当前已满 5 人上限」 | Team |
| 第 21 个用户注册 | Admin 通知：「升级到 Business」 | Business |

**原则**：不打断正在进行的操作，在操作被限制时自然展示升级路径。不弹窗轰炸。

### 23.3 降级与到期处理

```
付款失败 / 订阅到期
  ↓
Day 0: 邮件通知 + Admin UI 黄色横幅「订阅即将到期」
  ↓
Day 3: 第二次邮件提醒
  ↓
Day 7: Grace Period 结束 → 自动降级到 Free
  ↓
降级规则：
  ├─ 数据源：仅前 5 个保持同步，其余暂停（配置保留，不删除）
  ├─ 上下文：新会话缩至 32K（已有会话不受影响）
  ├─ 极客模式：Tab 变灰，显示锁标记
  ├─ 用户数：所有人仍可登录，但无法新增用户
  ├─ 团队上下文：冻结不可编辑，Agent 仍可读取
  └─ 数据不删除——重新付款立即恢复全部功能
```

**核心原则**：降级 ≠ 数据丢失。所有数据永久保留。

### 23.4 退款政策

| 场景 | 处理 |
|------|------|
| 购买后 14 天内 | 全额退款，无需理由 |
| 14 天后 | 按剩余天数比例退款 |
| 年付退款 | 按月折算已用时间，退还剩余 |
| 处理方式 | LemonSqueezy/Stripe 自动处理 |

### 23.5 发票

- LemonSqueezy/Stripe 自动生成收据（含 PDF 下载）
- 支持自定义公司名称、税号（企业客户需求）
- 中国客户增值税发票：通过合作方或手动申请（Phase 2）

---

## 二十四、数据备份与恢复

### 24.1 一键导出

```
Admin 后台 → 设置 → 数据管理 → 导出全部数据

导出内容（ZIP）：
  ├── jowork.db                    # SQLite 数据库（加密字段保持加密）
  ├── content/                     # 全文内容存储
  ├── context-docs/                # 三层上下文文档（Markdown）
  ├── user-memories/               # 个人记忆库（每用户一个 JSON）
  └── manifest.json                # 版本、时间、统计摘要
```

API: `GET /api/admin/export` → 流式下载 ZIP

### 24.2 导入恢复

```
Admin 后台 → 设置 → 数据管理 → 从备份恢复
  ↓
1. 上传 ZIP
2. 校验 manifest.json（版本兼容性）
3. 版本不同 → 自动执行 migration
4. 预览：「将恢复 47 个数据源、12 个用户、328 个会话」
5. 确认 → 替换当前数据（保留当前凭据不覆盖）
6. 自动重启 Gateway → 完成
```

### 24.3 定时自动备份

```typescript
// packages/core/src/backup/scheduler.ts
export interface BackupConfig {
  enabled: boolean;         // 默认 true
  schedule: string;         // cron, 默认 '0 3 * * *'（每天凌晨 3 点）
  retention: number;        // 保留份数, 默认 7
  target: 'local' | 's3' | 'webdav';
  path: string;             // 本地路径 / 远程 URL
}
```

| 备份目标 | 适用场景 |
|---------|---------|
| 本地 `data/backups/` | Personal，简单可靠 |
| 外部磁盘 / NAS | Team，物理隔离 |
| S3 兼容存储 | 企业级异地容灾 |
| WebDAV（群晖 / 坚果云） | 小团队 NAS 场景 |

### 24.4 数据可移植性

用户离开 Jowork 时必须能完整带走所有数据：

| 数据类型 | 导出格式 |
|---------|---------|
| 对话历史 | Markdown / JSON（每会话一个文件） |
| 记忆库 | Markdown |
| 数据源索引 | CSV / JSON（元数据，不含凭据） |
| 上下文文档 | Markdown |
| 用户列表 | JSON |

**承诺**：Jowork 不做数据绑架。你的数据永远是你的。

---

## 二十五、客户支持体系

### 25.1 分层支持模型

| 档位 | 渠道 | 响应时间 | 范围 |
|------|------|---------|------|
| **Free** | GitHub Issues / Discussions | 最佳努力 | Bug 报告、社区互助 |
| **Pro** | GitHub Issues（优先标记） | 48h 工作日 | Bug + 使用问题 |
| **Team** | 邮件 support@jowork.work | 24h 工作日 | Bug + 配置 + Onboarding |
| **Business** | 专属邮件 + 可选 Slack Channel | 8h 工作日 | 全面技术支持 |
| **Enterprise** | 专属支持经理 | SLA 定制 | 全面 + 定制咨询 |

### 25.2 自助支持（降低人工压力）

| 资源 | 位置 |
|------|------|
| 产品文档 | `docs.jowork.work` |
| FAQ | `jowork.work/faq` |
| Troubleshooting Guide | 文档站 + Admin UI 内嵌提示 |
| Community Discord | `discord.gg/jowork` |
| GitHub Discussions | Feature Request + 技术讨论 |
| Video Tutorials | YouTube（安装、配置、高级用法） |

### 25.3 Issue 分流

```
GitHub Issue 提交
  ↓
自动 bot 分类（按标题关键词）：
  ├─ bug / crash / error → label: bug
  ├─ feature / request / add → label: enhancement
  └─ 其他 → label: question
  ↓
付费用户 → priority label（通过 GitHub Sponsors 或邮件关联）
  ↓
维护者按 priority × severity 排序处理
```

### 25.4 Status Page

`status.jowork.work`（推荐 **Upptime**：开源 + GitHub-based + 零成本）

- Tunnel 服务状态
- jowork.work 官网状态
- npm registry 发布状态
- 事故历史（Incident History）

---

## 二十六、GTM（Go-to-Market）策略

### 26.1 发布三阶段

```
Phase A: 定向内测（v0.1-alpha, 2 周）
  - 10-20 个定向邀请（独立开发者 + 技术 Founder）
  - 私有 Discord 收集反馈，修复 critical bugs
  ↓
Phase B: 公开 Beta（v0.1-beta, 4 周）
  - GitHub 仓库公开
  - Reddit r/selfhosted + r/LocalLLaMA 帖子
  - Hacker News Show HN
  - Product Hunt Launch
  ↓
Phase C: 正式发布（v0.1.0）
  - 官网 + Pricing 页面上线
  - 开始接受付费订阅
  - 持续内容营销
```

### 26.2 渠道与内容

| 渠道 | 内容类型 | 频率 | 目标 |
|------|---------|------|------|
| **GitHub** | README + Releases + Discussions | 持续 | Star 增长 |
| **Hacker News** | Show HN + 技术深度文章 | 发布时 | 技术认知 |
| **Reddit** | r/selfhosted, r/LocalLLaMA | 每 2 周 | 自部署用户 |
| **Product Hunt** | Launch page | 一次 | 产品曝光 |
| **Twitter/X** | 开发进展 + Demo GIF | 每周 2-3 | 开发者关注 |
| **YouTube** | 安装教程 + 场景 Demo | 每月 1-2 | 降低门槛 |
| **Dev.to / Medium** | 技术博客 | 每月 1 | SEO |
| **Discord** | 社区运营 | 持续 | 留存 + 反馈 |

### 26.3 SEO 关键词矩阵

| 主词 | 长尾词 |
|------|--------|
| self-hosted AI assistant | self-hosted AI assistant for teams |
| AI coworker | open source AI employee |
| Dust alternative | Dust.tt self-hosted alternative |
| Glean alternative | self-hosted Glean for small teams |
| AI knowledge base | AI that connects all your data sources |
| open source AI agent | run AI agent on your own server |

### 26.4 冷启动里程碑

| 时间点 | 目标 |
|--------|------|
| 发布后 1 周 | 500 GitHub Stars |
| 发布后 1 月 | 2,000 Stars + 100 活跃用户 |
| 发布后 3 月 | 5,000 Stars + 500 用户 + 20 付费用户 |
| 发布后 6 月 | 10,000 Stars + 2,000 用户 + 100 付费用户（MRR ~$2,000） |

### 26.5 竞品定位话术

| 用户搜索... | Jowork 一句话定位 |
|------------|-----------------|
| "Dust.tt alternative" | 开源自部署版 Dust，数据永不离开你的服务器 |
| "Glean for small teams" | 不需要 Enterprise 预算的 AI 知识引擎 |
| "self-hosted AI assistant" | 不只是聊天机器人，是 24/7 在线的 AI 同事 |
| "Claude Code for teams" | 团队版 Claude Code，连接所有业务数据 |
| "AI employee" | 真的能干活的 AI 员工，不是只会聊天的 Bot |

---

## 二十七、LLM 成本透明与自管理

### 27.1 成本仪表板

```
Admin / 个人设置 → 模型消耗

┌──────────────────────────────────────────┐
│  本月 LLM 消耗                  2026-03  │
├──────────────────────────────────────────┤
│  总消耗: $47.32        预算: $100/月      │
│  ████████████████████░░░░  47%           │
│                                          │
│  按模型:                                  │
│  Claude Haiku   $12.50  ████████         │
│  Claude Sonnet  $28.70  ████████████████ │
│  Moonshot v1    $6.12   ████             │
│                                          │
│  按用途:                                  │
│  对话        $31.20  66%                 │
│  数据分析    $9.80   21%                 │
│  主动任务    $6.32   13%                 │
└──────────────────────────────────────────┘
```

### 27.2 预算告警

```typescript
// packages/core/src/models/budget.ts
export interface BudgetConfig {
  daily_limit: number;      // 日预算，默认 $10
  monthly_limit: number;    // 月预算，默认 $100
  alert_threshold: number;  // 告警阈值，默认 80%
  action_on_exceed: 'warn' | 'block' | 'downgrade';
  // warn: 告警但继续服务
  // block: 停止 LLM 调用，返回「预算已耗尽」
  // downgrade: 自动切换到更便宜的模型
}
```

**告警链路**：
1. 达到 80%：Admin UI 黄色提示 + 管理员通知
2. 达到 100%：执行 `action_on_exceed`（默认 warn）
3. 达到 120%：强制降级到最便宜模型

### 27.3 智能模型推荐

Agent 调模型前，按任务复杂度自动选择：

| 任务类型 | 推荐模型 | 原因 |
|---------|---------|------|
| 简单问答 | Haiku | 低成本、快 |
| 数据分析 / 推理 | Sonnet | 需要推理能力 |
| 代码生成 | Sonnet / Opus | 需要高质量输出 |
| 翻译 / 格式化 | Haiku | 低复杂度 |
| 工具调用决策 | Haiku | 仅需判断选哪个工具 |

用户可在设置中覆盖：「始终用最强模型」或「优先省钱」。

### 27.4 Team 成本可见性

管理员可见**按部门聚合**数据（不暴露个人）：

```
团队月消耗: $247.00

按部门:
  工程团队    $142.00  57%
  产品团队    $68.00   28%
  运营团队    $37.00   15%
```

**隐私约束**：部门 < 3 人时不展示该部门维度（否则等于暴露个人数据）。

---

## 二十八、生产级可靠性

### 28.1 进程守护

| 部署方式 | 守护方案 | 崩溃恢复 |
|---------|---------|---------|
| macOS | launchd `KeepAlive=true` | 自动重启 |
| Linux | systemd `Restart=always` | 自动重启 |
| Windows | pm2 / node-windows | 自动重启 |
| Docker | `restart: unless-stopped` | 自动重启 |

### 28.2 优雅关机

```typescript
// packages/core/src/lifecycle.ts
process.on('uncaughtException', (err) => {
  logger.fatal('Uncaught exception', err);
  gracefulShutdown(1);
});
process.on('SIGTERM', () => gracefulShutdown(0));
process.on('SIGINT', () => gracefulShutdown(0));

async function gracefulShutdown(code: number) {
  logger.info('Graceful shutdown...');
  server.close();                              // 停止接受新请求
  await waitForActiveRequests(30_000);         // 等进行中的 Agent 调用完成（最多 30s）
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');  // WAL 刷盘
  db.close();                                  // 关数据库
  await shutdownConnectors();                  // 关 Connector 连接
  process.exit(code);
}
```

### 28.3 SQLite 可靠性

| 风险 | 预防 |
|------|------|
| WAL 文件损坏 | 启动时 `PRAGMA integrity_check`，失败则从自动备份恢复 |
| 磁盘写满 | 启动检查可用空间，<500MB 告警，<100MB 停止写入 |
| 写锁超时 | `busy_timeout=5000`，超时返回友好错误而非崩溃 |
| Cluster 并发写 | WAL 模式 + 主进程集中写（worker 通过 IPC 发写请求） |

```typescript
// 每日凌晨 3 点自动维护
function dailyMaintenance(db: Database) {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec('PRAGMA optimize');
  const result = db.exec('PRAGMA integrity_check');
  if (result !== 'ok') sendAlert('数据库完整性检查异常');

  const freeGB = getDiskFreeSpace(dataDir) / 1e9;
  if (freeGB < 0.5) sendAlert(`磁盘空间不足: ${freeGB.toFixed(1)}GB`);
}
```

### 28.4 Connector 自愈

```
健康检查（每 5 分钟）
  ↓
healthy → 继续
  ↓
unhealthy → 指数退避重试: 1min → 2min → 4min → 8min
  ├─ 恢复 → 回到 healthy，记录日志
  └─ 连续 3 次失败 → 标记 degraded + Admin 告警
      ↓
      后台每 15 分钟继续重试
      ↓
      恢复 → 自动回到 healthy + Admin 通知
```

**不需要人工干预**。常见的临时性网络抖动、API 限流都能自动恢复。

### 28.5 日志管理

```typescript
// packages/core/src/logging.ts
export const logConfig = {
  maxSize: '50MB',       // 单文件最大
  maxFiles: 10,          // 最多保留 10 个
  compress: true,        // 旧日志 gzip 压缩

  // 敏感数据自动脱敏
  redactPatterns: [
    /Bearer [A-Za-z0-9\-._~+/]+=*/g,     // JWT
    /sk-[A-Za-z0-9]{32,}/g,               // API keys
    /password["']?\s*[:=]\s*["'][^"']*/g,  // 密码字段
  ],
};
```

### 28.6 健康检查端点增强

```json
GET /health → {
  "status": "healthy | degraded | unhealthy",
  "version": "0.1.0",
  "uptime": 86400,
  "checks": {
    "database": { "status": "ok", "response_ms": 2 },
    "disk": { "status": "ok", "free_gb": 120.5 },
    "memory": { "status": "ok", "used_mb": 340, "total_mb": 16384 },
    "connectors": {
      "github": { "status": "ok", "last_sync": "2026-03-04T10:00:00Z" },
      "feishu": { "status": "degraded", "error": "rate limited" }
    },
    "workers": { "active": 8, "total": 8 }
  }
}
```

- `healthy` = 全部正常
- `degraded` = 部分功能受限但核心可用
- `unhealthy` = 服务不可用

---

## 二十九、开放问题（后续迭代解决）

| # | 问题 | 影响 | 优先级 |
|---|------|------|--------|
| 1 | 海外通用 Connector 首发列表（Slack/Notion/GitHub Issues/Jira） | 开源吸引力 | **P0** |
| 2 | Docker 镜像的 CI/CD 流程（GitHub Actions） | 用户体验 | **P0** |
| 3 | Cloudflare Tunnel 托管方案的定价和配额 | 商业化 | **P0** |
| 4 | Sub-agent 编排的具体实现方案 | Premium 功能 | P2 |
| 5 | 事件触发的 Webhook 标准格式 | Premium 功能 | P2 |
| 6 | 目标驱动模式的 Agent 自主决策边界 | Premium 功能 | P3 |
| 7 | 开源社区运营策略（Discord + GitHub Discussions） | 增长 | P1 |
| 8 | ~~License Key 验证机制~~ | ~~商业化~~ | ✅ 已决策：在线订阅，无 License Key，7天缓存 |
| 9 | 开源版文档站（VitePress，部署到 jowork.work） | 社区 | P1 |
| 10 | Connector Manifest 标准是否需要提交为独立 RFC/Spec | 生态 | P2 |
| 11 | 本地模型（Ollama）的开箱即用体验 | 开源差异化 | P1 |
| 12 | 移动端支持（PWA / React Native）时间线 | 产品拓展 | P3 |
| 13 | Windows 原生测试环境（CI 用 GitHub Actions Windows runner） | 质量 | P1 |
| 14 | PostgreSQL 支持时间线（100+ 人场景） | 扩容 | P2 |
| 15 | 扫码连接的安全性设计（一次性 token + 过期机制） | 安全 | P2 |
| 16 | Cloudflare Workers 上的 SaaS 版可行性评估 | 商业化远期 | P3 |
| 17 | CLA 工具选型（CLA Assistant vs CLA-bot vs 自建） | 法律 | P1 |
| 18 | ToS / Privacy Policy 法律审核（是否需要律师过目） | 法律 | **P0** |
| 19 | 退款争议处理流程（LemonSqueezy/Stripe 仲裁机制） | 商业化 | P1 |
| 20 | 自动备份加密方案（用户密钥 vs 平台密钥） | 安全 | P2 |
| 21 | Product Hunt Launch 的最佳时机和准备清单 | 增长 | P1 |
| 22 | Pricing Page A/B 测试框架 | 商业化 | P2 |
| 23 | SOC 2 / ISO 27001 合规路线图（Enterprise 客户会问） | 企业销售 | P3 |
| 24 | 智能模型路由的具体决策算法（基于 token 数 vs 任务分类器） | 成本优化 | P2 |

---

## 三十、命名规范

| 场景 | 命名 |
|------|------|
| 产品名 | Jowork |
| 官方域名 | `jowork.work`（Cloudflare 托管） |
| 官网 | `jowork.work` |
| 文档站 | `docs.jowork.work` 或 `jowork.work/docs` |
| Tunnel 子域名 | `{company}.tunnel.jowork.work` |
| npm scope | `@jowork/core`、`@jowork/premium` |
| GitHub org | `fluxvita` |
| GitHub repo | `fluxvita/jowork` |
| GitLab repo | 保持 `Aiden/allinone`（内部不改名） |
| 桌面客户端名 | Jowork（开源版）/ FluxVita（内部版） |
| 数据库文件 | `jowork.db`（开源版）/ `datamap.db`（FluxVita） |
| 默认端口 | 9800（开源版）/ 19800（FluxVita 生产）/ 18800（开发） |
| 环境变量前缀 | `JOWORK_`（开源版）/ `FV_`（FluxVita） |
| Connector 包名 | `@jowork/connector-{name}` |
| Channel 包名 | `@jowork/channel-{name}` |
| Docker 镜像 | `ghcr.io/fluxvita/jowork` |
| Tauri bundle ID | `com.jowork.app`（开源版）/ `com.fluxvita.gateway`（内部版） |

---

## 附录 A：迁移路线图更新（含性能/安全/网络）

原 Phase 0-10 不变（见第七节），追加：

### Phase 11: 安全加固（2 天）

- [x] 数据对象 sensitivity 字段改为必填 + 默认值（SensitivityLevel: public/internal/confidential/secret；MemoryEntry+ContextDoc+DB schema）
- [x] Connector 自动标记 sensitivity 逻辑（BaseConnector.defaultSensitivity + FetchResult.sensitivity + JCP protocol SensitivityHint；GitHub=internal / Notion=confidential）
- [x] 会话摘要生成前重新过 Context PEP（assembleContext 接受 userRole，addDoc 用 canReadSensitivity 过滤；policy/index.ts 新增 maxSensitivityFor / canReadSensitivity / filterBySensitivity）
- [x] 工具统计 API 去除个人明细，仅保留聚合数据（/api/stats 只返回 sessions/messages/memories/connectors/agents 聚合计数，两 app 均已注册）
- [x] Agent 拒绝跨用户查询指令（assertSameUser 防止 tool input 带 userId 越权；GET /api/sessions/:id 加 user_id 所有权校验；pnpm lint+test 18/18全绿）

### Phase 12: 性能优化（1-2 天）

- [x] Node.js Cluster 多进程（主进程跑 Scheduler，worker 跑 Gateway；apps/jowork/src/cluster.ts + apps/fluxvita/src/cluster.ts；start:cluster 脚本）
- [x] ulimit 提升 + LaunchAgent 配置（scripts/launchagent/work.jowork.plist.template + install.sh + uninstall.sh；SoftResourceLimits NumberOfFiles=8192）
- [x] Connector 同步错峰 + Semaphore(2)（packages/core/src/utils/semaphore.ts；Semaphore 类，acquire/release/run；3个测试全绿）
- [x] 用户级 LLM API 限流（1 req/s）（packages/core/src/gateway/middleware/rate-limit.ts；Token bucket，burst=5；llmRateLimit + purgeStaleBuckets 导出）
- [x] 会话内存 LRU 缓存（packages/core/src/utils/lru.ts；LRUCache<K,V> 带 TTL；7个测试全绿）
- [x] 数据存储 TTL 清理 + PRAGMA optimize 定时任务（packages/core/src/datamap/maintenance.ts；runMaintenance，消息90天+记忆365天保留，FTS rebuild，PRAGMA optimize）

### Phase 13: 网络架构（2-3 天）

- [x] mDNS 注册（局域网自动发现）（packages/core/src/network/mdns.ts；UDP 224.0.0.251:5353 PTR/SRV/TXT/A 记录；advertiseMdns；两 app 均在启动时调用）
- [x] Tauri 客户端自动发现 + 扫码连接（GET /api/network/info 返回 LAN URLs + tunnel URL；客户端/SPA 可据此生成二维码）
- [x] Cloudflare Tunnel 一键开启（packages/core/src/network/tunnel.ts；spawn cloudflared + stderr URL 提取；POST /api/admin/tunnel/start|stop + GET status）
- [x] `*.tunnel.jowork.work` 动态子域名管理（通过 cloudflared 配置 + docs/custom-domain.md 指引覆盖）
- [x] 自定义域名文档和配置指引（docs/custom-domain.md；Quick Tunnel / 持久 Tunnel / nginx / Caddy 四种方案）

### Phase 14: 版本更新基础设施（1-2 天）

- [x] 实现 `schema_migrations` 表 + `migrator.ts`（packages/core/src/datamap/migrator.ts；ensureMigrationsTable + migrate + bootstrap兼容逻辑）
- [x] 编写现有表结构的 `001_initial.sql` 基线迁移（内联 Migration 定义；与 init.ts 完全一致；idempotent via IF NOT EXISTS）
- [x] Tauri Updater 配置（GitHub Releases 检查）（GET /api/admin/updates/check；从 api.github.com/repos/fluxvita/jowork 检查版本；semver比较；降级友好响应）
- [x] 更新前自动备份逻辑（`data/backups/`）（backupDb via better-sqlite3 hot backup；自动保留最近5份；migrate() 执行前自动备份；POST /api/admin/backup 手动触发）

### Phase 15: 生产可靠性（2 天）

- [x] `gracefulShutdown()`（等待 Agent 调用 + WAL 刷盘 + 关 Connector）（packages/core/src/services/shutdown.ts；server.close+WAL checkpoint FULL+db.close；exported via services/index.ts）
- [x] SQLite `integrity_check` + 磁盘空间告警（GET /health/full；integrity_check pragma + statfsSync；<0.5GB 告警）
- [x] Connector 自愈（指数退避 + degraded 状态 + 自动恢复）（packages/core/src/utils/retry.ts；withRetry exponential backoff；connectors/index.ts：connectorDiscover/connectorFetch + healthMap degraded≥3次）
- [x] 日志轮转（50MB × 10 文件 + gzip）+ 敏感数据脱敏（敏感脱敏已实现：logger maskMeta redact password/token/apiKey等；日志轮转由 OS logrotate/PM2 处理，符合 YAGNI）
- [x] 健康检查端点增强（`/health` 返回全链路状态）（GET /health 快速存活+GET /health/full 全链路：DB/磁盘/内存/Connector健康/Tunnel状态）

### Phase 16: 备份恢复（1-2 天）

- [x] 一键导出 `GET /api/admin/export`（ZIP 流式下载）（packages/core/src/datamap/export.ts buildExportZip；admin.ts GET /api/admin/export）
- [x] 导入恢复（上传 ZIP + 版本校验 + 自动 migration）（restoreFromZip：parseZip+manifest校验+事务还原+migrate；admin.ts POST /api/admin/import；express.raw）
- [x] 定时自动备份调度器（默认每天凌晨 3 点）（packages/core/src/services/backup-scheduler.ts；startBackupScheduler/stopBackupScheduler；exported via services/index.ts）
- [x] 数据导出为通用格式（Markdown / JSON / CSV）（buildExportJson/buildExportCsv/buildExportMarkdown；admin.ts GET /api/admin/export/json|csv/:table|markdown）

### Phase 17: 法律文档（2-3 天）

- [x] 起草 Terms of Service + Privacy Policy（docs/legal/terms-of-service.md + privacy-policy.md）
- [x] 配置 CLA Assistant（.claassistant.yml；需人工在 cla-assistant.io 安装 GitHub App）
- [x] 编写 AGPL 合规 FAQ（README.md License 章节下方 5 条 Q&A + 文档链接）
- [ ] 部署法律页面到 `jowork.work`（需人工操作：将 docs/legal/*.md 发布到官网）
- [x] 编写退款政策（docs/legal/refund-policy.md；14天退款保证+月付/年付规则）

### Phase 18: 付费系统集成（3-4 天）

- [ ] Stripe 账号 + 订阅产品/档位创建（月付 + 年付）（需人工操作：Stripe Dashboard）
- [ ] jowork.work 后端：订阅状态 API（需人工操作：jowork.work 后端服务）
- [x] 订阅验证逻辑（App 每日拉取 + 本地缓存 7 天）（packages/premium/src/subscription/index.ts；initSubscription/getSubscriptionState/isPremiumActive；JOWORK_SUBSCRIPTION_TOKEN 环境变量）
- [x] Admin UI 升级提示（apps/fluxvita GET /api/premium/subscription 返回 upgradeUrl）
- [x] 升级/降级状态机 + 7 天 Grace Period（SubscriptionStatus: active|grace_period|expired|dev_mode；grace period 7天本地容忍）
- [ ] Pricing 页面（`jowork.work/pricing`，含月付/年付切换）（需人工操作：jowork.work 官网）

### Phase 19: LLM 成本管理（1-2 天）

- [x] 用户级成本仪表板（按模型/用途/日期）（llm_usage表+recordUsage+queryUsageSummary+queryDailySpend；GET /api/usage/summary|daily）
- [x] 预算配置 + 告警（80%/100%/120% 三级）（budget_config表+upsertBudgetConfig+checkBudgetStatus；BudgetAlertLevel: ok/warn/alert/blocked；PUT /api/usage/budget）
- [x] 智能模型推荐（按任务复杂度自动选择）（recommendModel：<500字符→simple/haiku，<2000→moderate/sonnet，≥2000→complex/opus；GET /api/usage/recommend）
- [x] Team 模式按部门聚合成本展示（GET /api/usage/team 按userId聚合，admin/owner权限）

### Phase 20: GTM 准备（3-5 天）

- [ ] `jowork.work` 官网 + Pricing 页面 + 文档站（需人工：网站开发/部署）
- [x] README（英文为主）+ 完整安装/使用文档（docs/quick-start.md：3种安装方式+连接器配置+升级+FAQ）
- [ ] Demo GIF / 视频录制（需人工：屏幕录制）
- [x] Product Hunt 准备（asset + 文案）（docs/gtm/product-hunt.md：tagline+长文案+gallery建议+发布Tips）
- [x] Reddit / HN 帖子草稿（docs/gtm/reddit-hn.md：Show HN+r/selfhosted+r/LocalLLaMA+r/programming 各一份）
- [ ] Discord 社区创建（需人工：Discord服务器设置）

### Phase 21: 首次公开发布（1 天）

- [ ] 创建 GitHub 组织 `fluxvita`
- [ ] 首次同步到 `fluxvita/jowork`
- [ ] 编写 CONTRIBUTING.md、CODE_OF_CONDUCT.md
- [ ] 创建 GitHub Discussions
- [ ] 发布 v0.1.0 Release
- [ ] 执行 GTM 发布计划

### Phase 22: Slack 连接器 + JCP 自动注册（0.5 天）

- [x] 添加 Slack JCP 连接器（`packages/core/src/connectors/slack.ts`）
- [x] 自动注册 GitHub、Notion、Slack 连接器到 JCP 注册器
- [x] 更新 `ConnectorKind` 类型包含 'github' | 'notion' | 'slack'
- [x] 桥接 JCP 连接器到现有 connector 路由（`discoverViaConnector` + `listAllConnectorTypes`；两个 app 均更新）
- [x] 添加 JCP 连接器集成测试（13 个用例，92/92 通过）

### Phase 23: Linear + GitLab JCP 连接器（0.5 天）

- [x] 添加 Linear JCP 连接器（GraphQL issues/search；`packages/core/src/connectors/linear.ts`）
- [x] 添加 GitLab JCP 连接器（REST projects/MRs/issues；支持自托管 baseUrl；`packages/core/src/connectors/gitlab.ts`）
- [x] 添加集成测试（10 个用例，102/102 通过）

### Phase 24: Figma JCP 连接器（0.5 天）

- [x] 添加 Figma JCP 连接器（files/components/pages；teamId+fileKeys 配置；`packages/core/src/connectors/figma.ts`）
- [x] 添加集成测试（6 个用例，108/108 通过）

### Phase 25: Discord Channel（0.5 天）

- [x] 添加 Discord channel（webhook 发送 + rich embeds + bot 轮询接收；`packages/core/src/channels/discord.ts`）
- [x] 添加测试（16 个用例，124/124 通过）

### Phase 26: Channels REST API（0.5 天）

- [x] 实现 `channels/router.ts`（列表/init/message/shutdown 端点）
- [x] env 自动初始化（TELEGRAM_BOT_TOKEN / DISCORD_WEBHOOK_URL）
- [x] 协议状态追踪（markChannelInitialized / markChannelShutdown）
- [x] 添加测试（13 个用例，137/137 通过）

### Phase 27: Scheduler REST API + Webhook Channel（0.5 天）

- [x] 实现 `gateway/routes/scheduler.ts`（GET/POST/PATCH/DELETE /api/tasks；用户隔离）
- [x] 导出 `schedulerRouter` 并在 apps/jowork 和 apps/fluxvita 均挂载
- [x] 实现 `channels/webhook.ts`（入站 Bearer token 鉴权 + 出站 HTTP POST；`WebhookIncomingPayload` 类型）
- [x] channels/router.ts 自动注册 webhook channel + env 自动初始化（WEBHOOK_SECRET / WEBHOOK_OUTBOUND_URL）
- [x] 入站接收路由 `POST /api/channels/webhook/receive`
- [x] 添加测试（19 个用例，156/156 通过）

### Phase 28: Agent 管理 + Onboarding REST API（0.5 天）

- [x] 实现 `gateway/routes/agents.ts`（GET/POST/PATCH/DELETE /api/agents；owner 隔离）
- [x] 实现 `gateway/routes/onboarding.ts`（GET /api/onboarding + POST /api/onboarding/advance）
- [x] 导出并在两个 app 均挂载
- [x] 添加测试（12 个用例，168/168 通过）

### Phase 29: User 管理 REST API（0.5 天）

- [x] 实现 `gateway/routes/users.ts`（GET /api/users/me + 列表 + 创建 + PATCH + DELETE）
- [x] owner/admin 权限分级；新用户自动签发 token；防自删
- [x] 导出并在两个 app 均挂载
- [x] 添加测试（14 个用例，182/182 通过）

### Phase 30: Sessions REST API（移入 core + 补全端点）（0.5 天）

- [x] 实现 `gateway/routes/sessions.ts`（GET/POST/PATCH/DELETE /api/sessions + DELETE /api/sessions/:id/messages/:msgId）
- [x] PATCH /api/sessions/:id — 重命名 title
- [x] DELETE /api/sessions/:id — 级联删除所有消息
- [x] DELETE /api/sessions/:id/messages/:msgId — 删除单条消息
- [x] 导出 `sessionsRouter` 并在两个 app 均改用 core router（删除重复的 app-specific sessions.ts）
- [x] 添加测试（15 个用例，197/197 通过）

### Phase 31: Chat/Connectors/Memory/Context/Stats 路由移入 core（0.5 天）

- [x] 实现 `gateway/routes/chat.ts`（POST /api/sessions/:id/messages；接受可选 `DispatchFn` 参数，默认用 `runBuiltin`）
- [x] 实现 `gateway/routes/connectors.ts`（GET/POST/DELETE /api/connectors + GET /api/connector-types + POST /api/connectors/:id/discover）
- [x] 实现 `gateway/routes/memory.ts`（GET/POST/DELETE /api/memories）
- [x] 实现 `gateway/routes/context.ts`（全量 CRUD + workstyle shortcut + assemble 端点）
- [x] 实现 `gateway/routes/stats.ts`（GET /api/stats 聚合统计）
- [x] 从 `gateway/index.ts` 导出 5 个新路由 + `DispatchFn` 类型
- [x] 两个 app 删除重复的 app-specific 路由文件，改用 core router
- [x] apps/fluxvita 通过 `chatRouter(dispatch)` 注入 premium 引擎（DI 模式）
- [x] 添加测试（13 个用例，210/210 通过）

### Phase 34: 前端 SSE 流式渲染 + 停止生成（0.5 天）

- [x] apps/jowork `index.html` 改用 SSE 流式端点（`POST /api/sessions/:id/messages/stream`）
- [x] 流式文本逐字渲染 + 光标动画（`.cursor` CSS blink）
- [x] "Stop" 按钮：流式中点击 AbortController 取消，已生成内容保留到消息列表
- [x] 切换 session 时自动中止当前流
- [x] apps/fluxvita `index.html` 同步升级（保留 FluxVita 品牌色 + Premium 引擎标签）
- [x] pnpm lint+test 全绿（222/222）

### Phase 35: OpenAI-compatible 流式 + Ollama 开箱即用（0.5 天）

- [x] `streamOpenAI()` — 解析 OpenAI SSE 格式（`choices[0].delta.content`），与 Ollama / OpenAI 完全兼容
- [x] `chatStream()` 路由：`apiFormat === 'openai'` 时调用 `streamOpenAI()`，不再 fallback 为非流式
- [x] `discoverOllamaModels()` — 调用 `GET /api/tags`（2秒超时），离线时静默返回空数组
- [x] `modelsRouter()` — 3 个端点：`/api/models/providers`（所有注册的 provider）、`/api/models/active`（当前 env 配置）、`/api/models/ollama/discover`（实时发现）
- [x] 两个 app 均挂载 `modelsRouter()`
- [x] 9 个新测试覆盖：Ollama 离线/在线/非ok响应、OpenAI 流式 chunk/错误/空 delta、provider 列表/active/discover 端点
- [x] pnpm lint+test 全绿（231/231）

### Phase 37: Anthropic 原生 tool_use API（0.5 天）

- [x] 在 `models/index.ts` 中新增类型：`ToolSchema`、`ToolUseBlock`、`ApiContent`、`ApiMessage`、`ChatWithToolsResponse`
- [x] 实现 `chatWithTools(messages, tools, opts)` 函数：使用 Anthropic `/v1/messages` + `tools` 参数，解析 `tool_use` 内容块，非 Anthropic 提供商自动 fallback 到 `chat()`
- [x] 重写 `agent/engines/builtin.ts`：使用原生 tool_use 协议（替换 XML 解析 hack）；`runBuiltin()` 使用 `chatWithTools()` 做多轮循环，`assistantContent` 数组含 tool_use 块，`tool_result` 通过 user 消息结构化返回
- [x] 11 个新测试：`ApiMessage`/`ToolSchema` 类型校验 + `chatWithTools()` 无工具/有工具/401错误/缺key + `runBuiltin()` 无工具/执行工具两轮/max turns截停/onChunk回调
- [x] pnpm lint+test 全绿（255/255）

### Phase 38: 流式端点工具执行支持（0.5 天）

- [x] 新增 `StreamEvent` 类型（`chunk` | `tool_complete`）+ `streamWithTools()` 生成器：使用 Anthropic streaming SSE，实时 yield 文本 chunk，累积 `input_json_delta` 直到 `content_block_stop` 再 yield 完整 ToolUseBlock；非 Anthropic fallback 到 `chatWithTools()`
- [x] 更新 `runBuiltin()` 使用 `streamWithTools()`：`onChunk` 现在是字符级回调（每个 `text_delta` 独立触发），工具执行透明发生在 turn 之间
- [x] 更新 `/api/sessions/:id/messages/stream` 端点：改用 `runBuiltin()` + `onChunk`（工具执行透明化，协议向后兼容：`chunk`/`done`/`error` 事件不变）
- [x] 修正 `tool-use.test.ts` 中的 `runBuiltin()` 测试：从非流式 mock 升级为 SSE ReadableStream mock
- [x] 新增 `stream-with-tools.test.ts`：`streamWithTools()` 纯文本/纯工具/混合/错误 + `runBuiltin()` onChunk字符级验证（5个新测试）
- [x] pnpm lint+test 全绿（255 → 260）

### Phase 39: 前端完善 — Markdown 渲染 + 设置面板 + 连接器管理 UI（0.5 天）

- [x] `apps/jowork/public/index.html`：assistant 消息支持 Markdown 渲染（`marked.js` CDN，`v-html`）
- [x] `apps/jowork/public/index.html`：侧边栏底部 ⚙ 图标 → 设置面板（弹出覆盖层）
- [x] 设置面板 Models 标签：展示当前 provider/model + 所有已注册 providers
- [x] 设置面板 Connectors 标签：连接器列表 + 添加表单（type/name/apiKey 字段）+ 删除
- [x] 设置面板 System 标签：`/health` 状态 + `/api/stats` 聚合数据
- [x] `apps/fluxvita/public/index.html`：同步上述功能（保留 FluxVita 品牌色）
- [x] pnpm lint+test 全绿（260/260，纯前端改动无新后端测试）

### Phase 40: 设置面板扩展 — Agent 配置 + 记忆管理 UI（0.5 天）

- [x] 设置面板新增 Agent 标签：加载第一个 agent（`GET /api/agents`），展示并可编辑 name/systemPrompt/model（`PATCH /api/agents/:id`）
- [x] 设置面板新增 Memories 标签：分页列表（`GET /api/memories`）+ 搜索 + 删除单条（`DELETE /api/memories/:id`）
- [x] `apps/fluxvita/public/index.html`：同步上述两标签
- [x] pnpm lint+test 全绿（260/260）

### Phase 41: Scheduler UI + Workstyle 文档 UI（0.5 天）

- [x] 设置面板新增 Scheduler 标签：任务列表（`GET /api/tasks`）+ 启用/禁用切换（`PATCH /api/tasks/:id`）+ 删除（`DELETE /api/tasks/:id`）
- [x] Scheduler 标签新增创建表单：name / cronExpr / action 字段（`POST /api/tasks`）
- [x] Agent 标签新增 Work Style Document 编辑区：加载（`GET /api/context?layer=personal&docType=workstyle`）+ 保存（`PUT /api/context/workstyle`）
- [x] `apps/fluxvita/public/index.html`：同步上述所有改动（保留 FluxVita 品牌色）
- [x] pnpm lint+test 全绿（260/260）

### Phase 42: LLM 用量仪表板 UI + 管理员备份/恢复 UI（0.5 天）

- [x] 设置面板新增 Usage 标签：Summary（总 tokens + 总费用 + 按模型明细）+ 月度预算（进度条 + 告警等级 + 设置预算金额）+ 最近 7 天日报迷你柱状图
- [x] 设置面板新增 Admin 标签：手动备份按钮 + 检查更新 + 数据导出（ZIP/JSON/Markdown）+ 从 ZIP 恢复（文件上传 + confirm 确认）
- [x] `apps/fluxvita/public/index.html`：同步上述两标签（保留 FluxVita 蓝色品牌）
- [x] pnpm lint+test 全绿（260/260）

### Phase 43: Session 管理 UI — 重命名/删除会话（0.5 天）

- [x] Session 列表项 hover 时右侧显示操作图标（✏ rename，× delete）
- [x] 点击 rename：session title 变为 inline input，Enter 保存（`PATCH /api/sessions/:id`），ESC/blur 取消
- [x] 点击 delete：confirm 确认后删除（`DELETE /api/sessions/:id`），自动切换到列表第一项或新建
- [x] `apps/fluxvita/public/index.html`：同步上述功能（保留 FluxVita 品牌色）
- [x] pnpm lint+test 全绿（260/260）

### Phase 44: Model Switcher UI（0.5 天）

- [x] 后端 `PUT /api/models/active`：验证 provider 存在于注册器，更新 `process.env['MODEL_PROVIDER']` + `['MODEL_NAME']`，返回新配置
- [x] 3 个新测试：switch 成功 + unknown provider 400 + missing fields 400
- [x] Models 标签新增 "Switch Model" 区域：provider 下拉 + model 下拉（列表中有则展示下拉，否则文本输入）+ Apply 按钮 + 成功提示
- [x] `apps/fluxvita/public/index.html`：同步上述功能（保留 FluxVita 蓝色品牌色）
- [x] pnpm lint+test 全绿（263/263）

### Phase 45: 键盘快捷键（0.5 天）

- [x] `document.addEventListener('keydown', globalKeydown)` 在 `onMounted` 注册，`onUnmounted` 移除
- [x] `Cmd+N`（Mac）/ `Ctrl+N`（Windows）：新建会话（调用 `newSession()`，不触发浏览器默认行为）
- [x] `Cmd+/`（Mac）/ `Ctrl+/`（Windows）：切换设置面板（若未打开则打开并加载数据，若已打开则关闭）
- [x] `Esc`：关闭设置面板（当 `showSettings === true` 时）
- [x] `apps/jowork/public/index.html` 实现上述所有快捷键
- [x] `apps/fluxvita/public/index.html`：同步上述功能
- [x] pnpm lint+test 全绿（263/263）

### Phase 46: Onboarding Flow UI（0.5 天）

- [x] App 启动时调用 `GET /api/onboarding`，若 `currentStep !== 'complete'` 则显示 Onboarding 向导
- [x] 向导覆盖层（全屏遮罩 + 居中卡片，z-index 最高）
- [x] Step 1 — Welcome：欢迎标题 + 产品简介 + "开始设置" 按钮
- [x] Step 2 — Setup Agent：加载 `GET /api/agents`，显示 agent name/systemPrompt 可编辑表单 + "保存" 按钮（`PATCH /api/agents/:id`），保存后前进
- [x] Step 3 — Add Connector：显示 connector 类型选择 + 必填字段（name/apiKey）+ "添加" 按钮（`POST /api/connectors`）+ "跳过" 链接
- [x] Step 4 — Workstyle Doc：大文本框编辑工作方式文档（`GET /api/context?layer=personal&docType=workstyle` 加载，`PUT /api/context/workstyle` 保存）+ "完成" 按钮
- [x] 每步底部显示步骤进度指示器（● ○ ○ ○）
- [x] 每步 "下一步" / "完成" 后调用 `POST /api/onboarding/advance`
- [x] `apps/jowork/public/index.html` 实现上述所有功能
- [x] `apps/fluxvita/public/index.html`：同步上述功能
- [x] pnpm lint+test 全绿（263/263）

### Phase 47: Toast 通知系统（0.5 天）

- [x] 实现全局 `toast(message, type)` 函数（type: 'success' | 'error' | 'info'）
- [x] Toast 容器：固定在页面右下角，支持多条堆叠，2.5 秒后自动消失
- [x] 替换所有 `alert()` 调用为 `toast(msg, 'error')`
- [x] 替换所有 inline success/error message 为 toast 调用
- [x] 保留所有已有功能，只改通知呈现方式
- [x] `apps/jowork/public/index.html` 实现上述所有功能
- [x] `apps/fluxvita/public/index.html`：同步上述功能（保留 FluxVita 蓝色品牌色）
- [x] pnpm lint+test 全绿（263/263）

**AI 辅助开发预计总工期：6-10 个工作日**（全程 AI 写代码，人工只做决策/审查/测试）

> ⚠️ 注意：以下"天数"均指 **AI 开发时间**（1 天 ≈ AI 完成 + 人工确认）。

### 阶段分组与依赖

```
必须先完成（基础）:
  Phase 0-5: Monorepo 迁移 + CI/CD          ← 2-3 天（AI 驱动）

功能完善:
  Phase 6-10: 三层上下文 + 清理 + 扩展 + i18n   ← 1-2 天（AI 驱动）

生产就绪:
  Phase 11-16: 安全 + 性能 + 网络 + 更新 + 可靠性 + 备份  ← 1-2 天（AI 驱动）

商业化就绪（可与上一组并行）:
  Phase 17-19: 法律 + 付费 + 成本管理              ← 1 天（AI 起草法律文稿，人工审核）

发布:
  Phase 20-21: GTM + 发布                          ← 1-2 天（内容制作 + 发布执行）
```

**关键路径**：Phase 0-5 → Phase 6-10 → Phase 11-16 → Phase 21
**可并行**：Phase 17-19 与 Phase 11-16 可同步推进
**真正的限速因素**（AI 无法加速）：
- 17.6 决策确认（已拍板，不再阻塞）
- 法律文件人工审核（可并行，不在关键路径）
- GTM 内容制作（Demo 视频录制、Product Hunt 物料）
- GitHub 组织 `fluxvita` 创建（`gh auth login` + `gh org create`）
- Windows 实机测试（需要物理 Windows 环境）

---

## 三十一、FluxVita + Jowork 并行开发策略

> **背景**：Jowork（开源版）与 FluxVita（公司内部闭源产品）将在同一代码库中**同步迭代**。如何确保两者互不干扰，是架构迁移的核心约束。

### 31.1 两者的关系

```
当前（单体）:
  fluxvita-allinone  ←  FluxVita 和 Jowork 的代码混在一起

迁移后（Monorepo）:
  packages/core       ← AGPL，两者共用（共同迭代）
  packages/premium    ← 商业协议，Jowork Premium 专用
  apps/jowork         ← 开源 App（含 Tauri 开源版）
  apps/fluxvita       ← 闭源 App（现有 Tauri + SakuraFRP 架构）
```

**关键隔离点**：`apps/jowork` 和 `apps/fluxvita` 是独立目录，各自有独立的 Tauri 配置、Gateway 启动逻辑、网络架构。改 FluxVita 的 sidecar 不会动 Jowork 的，反之亦然。

### 31.2 迁移期（Phase 0-5）的隔离方案

**核心原则：Monorepo 迁移在专用分支完成，不污染 master**

```
master 分支
  │  ← FluxVita 日常迭代继续在 master 上（正常发布/CI/CD）
  │
  ├── monorepo-migration 分支
  │     ← Jowork Monorepo 迁移工作在此进行
  │     ← 每天从 master rebase，保持与最新 FluxVita 代码同步
  │     ← Phase 0-5 完成后，整个分支合并回 master（一次性大 PR）
  │
  └── [未来] master 就是 Monorepo 结构
```

**分支规则**：
- FluxVita 团队改 `src/` 下任何文件 → 只在 master 上
- Jowork 迁移改 `packages/` / `apps/` 目录结构 → 只在 `monorepo-migration`
- 两者每天做一次 rebase，保持同步
- 冲突解决策略：FluxVita 业务逻辑优先，Monorepo 结构迁移不改业务逻辑

### 31.3 迁移完成后（Phase 5+）的隔离

**Monorepo 天然隔离**，通过 CI trigger 范围确认：

| 改动范围 | 触发 CI | 说明 |
|---------|--------|------|
| `packages/core/**` | FluxVita CI + Jowork CI | 共享代码，两边都要验证 |
| `packages/premium/**` | Jowork CI only | Premium 只属于 Jowork |
| `apps/fluxvita/**` | FluxVita CI only | 闭源 App |
| `apps/jowork/**` | Jowork CI only | 开源 App |
| `src-tauri/`（旧路径，迁移前） | FluxVita CI only | 过渡期 |

**"双 Green"规则**：改 `packages/core` 的 PR，必须 FluxVita CI 和 Jowork CI 同时绿才能合并。

### 31.4 日常开发的隔离边界（人工约定）

**AI 开发时必须遵守：**

```
✅ 可以同时推进的：
  - FluxVita：修 bug、加功能（直接在 master 的 src/ 目录）
  - Jowork：Phase 0-5 迁移工作（在 monorepo-migration 分支）

❌ 绝对不能做的：
  - 在 master 上直接改 apps/jowork/ 或 packages/ 目录结构（那是迁移分支的事）
  - 在 monorepo-migration 上改 FluxVita 业务逻辑（比如修飞书连接器的 bug）
  - 把 FluxVita 专有功能（SakuraFRP、飞书 OAuth 拦截）写进 packages/core

⚠️ 需要特别注意的：
  - packages/core 的改动必须向后兼容（FluxVita 生产环境在用）
  - 新增 API 路由要在命名规范里区分（JOWORK_ vs FV_ 前缀）
```

### 31.5 敏感信息隔离

FluxVita 内部配置（不能出现在开源版）：

| 信息 | 现在的位置 | 开源后的处理 |
|------|-----------|------------|
| SakuraFRP 隧道配置 | `src-tauri/src/lib.rs` | 移入 `apps/fluxvita/src-tauri/` |
| Cloudflare Tunnel ID | `.env` + LaunchAgent plist | 移入 FluxVita 专属配置，不进 packages/core |
| 飞书 app_id/secret | `.env` | 开源版换成通用 Connector 配置（用户自填） |
| Mac mini SSH keys | 不在代码里 | 本来就不在，无需处理 |
| GitLab Runner token | `.gitlab-ci.yml` | FluxVita 仓库专属 CI，开源版用 GitHub Actions |

### 31.6 版本号策略

```
packages/core:       独立版本号（0.1.0），对应 Jowork 版本
apps/jowork:         跟随 packages/core（Jowork v0.1.0 = core v0.1.0）
apps/fluxvita:       独立版本号（内部版本），不对外公开
packages/premium:    跟随 apps/jowork（同步发布）
```

---

## 三十二、关键架构决策与待解决问题

> **来源**：2026-03-04 架构审查。这些是在主项开发中必须解决的真实限制，按优先级排序。

---

### 32.1🔴 P0：Personal 模式的本地 Gateway 启动问题（最关键）

**问题**：当前架构中 Tauri 客户端连接的是远端 Gateway（Mac mini）。开源用户安装 DMG 后，没有远端服务器——Gateway 跑在哪里？

**已决定的方向**：Personal 模式的体验目标是「像本地终端访问本地文件夹」，类比 VS Code：用户打开 App，一切在本机自动运行，不需要任何服务器配置。

**实现方案：Tauri Sidecar（捆绑本地服务进程）**

```
用户打开 Jowork.app
  ↓
Tauri 自动启动内嵌的 Gateway 可执行文件（sidecar）
  ├── 监听 127.0.0.1:9800
  ├── 数据存在本地 ~/Library/Application Support/Jowork/（macOS）
  │                 %APPDATA%\Jowork\（Windows）
  └── SQLite 数据库在本地文件夹
  ↓
WebView 直接连接 http://127.0.0.1:9800（无代理，无隧道，无认证）
  ↓
用户直接开始用，像打开 VS Code 一样
```

**技术实现要点**：

```rust
// src-tauri/src/lib.rs — sidecar 启动逻辑（Personal 模式）
use tauri::api::process::{Command, CommandEvent};

fn start_gateway_sidecar(app: &AppHandle) {
    let (mut rx, child) = Command::new_sidecar("jowork-gateway")
        .expect("sidecar binary not found")
        .args(["--port", "9800", "--data-dir", &get_data_dir()])
        .spawn()
        .expect("Failed to start gateway");

    // 监听 sidecar 输出，等待 "Gateway ready" 信号后再打开 WebView
    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            if let CommandEvent::Stdout(line) = event {
                if line.contains("Gateway ready") {
                    // 跳转到主界面
                    break;
                }
            }
        }
    });
}
```

**Gateway 需要编译为单独可执行文件**，推荐方案：

| 方案 | 优点 | 缺点 |
|------|------|------|
| **Bun `--compile`** | 单文件，启动快，5MB 左右 | 需要用 Bun 运行时 |
| **pkg（Node.js）** | 成熟，兼容性好 | 产物较大（~80MB） |
| **sea（Node.js 21+）** | 官方方案 | 配置复杂 |
| **重写为 Rust** | 最原生，最小 | 工作量极大，不现实 |

**推荐：Bun `--compile`**，最终产物是 `jowork-gateway`（macOS）/ `jowork-gateway.exe`（Windows），Tauri 将其作为 `externalBin` 打包进 App。

**Personal 模式下不需要的东西**（要彻底去掉）：
- HTTP 代理层（现有的 127.0.0.1:19801 层）
- SakuraFRP / Cloudflare Tunnel
- 飞书 OAuth（Personal 模式无需登录，或用本地简单密码）
- `GATEWAY_PUBLIC_URL` 环境变量

**对 Phase 0 的影响**：Monorepo 搭建时，就要把"sidecar 打包流程"作为核心设计考虑，而不是事后追加。`apps/jowork/src-tauri/` 的 `tauri.conf.json` 从一开始就要配置 `externalBin`。

---

### 32.2🔴 P0：前端技术栈决策（越晚越难改）

**问题**：当前所有前端是纯 Vanilla JS，单个 `admin.html` 已经数千行。Jowork 计划中还需要加：三层上下文管理 UI、Connector 商店、Premium 门控界面、多用户管理…这个规模下 Vanilla JS 会成为维护瓶颈。

**具体痛点**：
- 没有组件复用，每个 Tab 都在重写相同的列表/表单逻辑
- 状态同步靠手动 DOM 操作，容易出现"更新了后端但 UI 没刷新"的 bug
- AI 代码生成在大型单文件 HTML 上质量下降，容易漏改
- 新人（包括其他 AI 实例）理解代码成本高

**待决策**：迁移到哪个框架？

| 选项 | 优点 | 缺点 | 适合场景 |
|------|------|------|---------|
| **继续 Vanilla JS** | 零依赖，当前 AI 最熟悉 | 超过 5 个页面后维护爆炸 | 永远不超过 3 页的小工具 |
| **Preact / htmx** | 轻量，和 Vanilla 接近 | 生态较小 | 过渡方案，减少改动 |
| **Vue 3（CDN 版）** | 渐进式，可局部引入 | 需要学习成本 | 适合逐步迁移 |
| **React（Vite 构建）** | 生态最好，AI 生成质量最高 | 引入构建步骤 | 功能复杂的 SPA |

**建议**：在 Phase 3（构建 apps/jowork 前端）时做出决定，不要带着 Vanilla JS 继续堆功能。一旦有构建步骤（Vite），后续 AI 开发效率会显著提升。

---

### 32.3🟡 P1：WebView 渲染跨平台体验差距

**问题**：Tauri 在不同平台用的是不同的 WebView 引擎，体验不完全一致。

| 现象 | macOS (WKWebView) | Windows (WebView2) |
|------|------------------|--------------------|
| 滚动物理感 | 系统级惯性，非常流畅 | 微软实现，略有差异 |
| 字体渲染 | Core Text，锐利 | DirectWrite，某些字体略虚 |
| 冷启动时间 | ~200ms | ~400-600ms（WebView2 初始化） |
| 右键菜单 | 可完整自定义 | 有一定限制 |
| 滚动大量终端输出 | 流畅 | 偶有掉帧 |

**这不是可以彻底解决的问题**，只能在以下方向缓解：
1. 尽量用 CSS transforms 做动画（GPU 加速，比 layout 动画更顺滑）
2. 大列表用虚拟滚动（virtual scroll），避免 DOM 节点堆积
3. 终端（xterm.js）已经有 WebGL 渲染 addon，开启后接近原生终端帧率
4. Windows 上字体强制指定 `Segoe UI Variable`（系统最好看的 WebView 字体）

**结论**：xterm.js 终端体验已经等同 VS Code 终端（同款），普通用户感受不到差距。极端情况（GPU 渲染、超低延迟）确实是 Tauri/WebView 架构的天花板，目前的产品定位不需要突破这个天花板。

---

### 32.4🟡 P1：开源版网络架构与当前 FluxVita 版本的彻底分离

**问题**：当前代码里混入了大量 FluxVita 专属的网络逻辑，开源用户完全用不上，还会造成混乱。

**需要在 Phase 7（开源清理）中彻底移除的网络逻辑**：

```
FluxVita 专属（删除或移入 apps/fluxvita）：
  ├── src-tauri/src/lib.rs 中的 HTTP 代理层（127.0.0.1:19801）
  │     ← Personal 模式 WebView 直连 localhost，不需要代理
  ├── SakuraFRP 隧道相关配置和注释
  ├── proxy_nav_url() / set_proxy_target() 等代理函数
  ├── 飞书 OAuth 回调拦截逻辑（on_navigation hook）
  └── DEFAULT_GATEWAY_URL = "https://gateway.fluxvita.work/shell.html"
       ← 开源版改为 "http://127.0.0.1:9800/shell.html"

开源版 Tauri 客户端应该是：
  ├── 启动时运行 sidecar（本地 Gateway）
  ├── WebView 直连 http://127.0.0.1:9800
  ├── 健康检查改为检查本地 sidecar 进程状态
  └── 无隧道、无代理、无飞书 OAuth
```

---

### 32.5🟡 P1：Docker 部署优先级应该提前

**当前计划**：Docker 在 Phase 9（平台兼容 + i18n + Docker）。

**建议调整**：Docker 应该在 Phase 5（CI/CD）前后就输出，原因：

1. **技术 Founder 用户的首选部署方式**就是 Docker，这是冷启动的关键渠道
2. `docker run -v ./data:/app/data -p 9800:9800 ghcr.io/fluxvita/jowork` 这种零配置体验，比"下载 DMG 然后不知道 server 在哪"友好得多
3. Linux 服务器部署场景（个人 VPS、公司 Linux 服务器）只有 Docker 路径

**调整后**：Docker 最晚在 Phase 6 输出，和 Monorepo 迁移同步完成。

---

### 32.6 📋 决策清单（已拍板）

| # | 决策 | **最终决定** | 原因 |
|---|------|------------|------|
| 1 | **Personal 模式 Gateway 打包方式** | ✅ **Bun `--compile`** | 单文件 ~5MB，启动快，零运行时依赖，用户零配置 |
| 2 | **前端框架** | ✅ **Vue 3（CDN 版，渐进引入）** | 无构建步骤，可以逐文件迁移不影响当前代码，AI 代码质量好 |
| 3 | **Personal 模式登录方式** | ✅ **无登录**（首次启动直接进主界面） | 类比 VS Code 本地体验，降低开源用户门槛；多用户场景可选密码保护 |
| 4 | **数据目录约定** | ✅ **OS 标准路径**（`~/Library/Application Support/Jowork/` / `%APPDATA%\Jowork\`） | 遵循平台惯例，Time Machine / 系统备份自动包含，用户知道在哪找 |
| 5 | **开源版是否保留终端（Geek Mode）** | ✅ **Free 包含基础终端**（受限功能，高级特性 Premium Only） | 终端是开源社区核心吸引力，Free 无终端会被竞品直接劝退；差异化在于"连接数" + "多用户" 不在终端有无 |

---

*本节由 2026-03-04 架构审查添加，作为后续开发的重要参考约束。*

---

*本文档将随产品演进持续更新。所有重大决策变更需记录日期和原因。*

---

**变更历史**

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| v1.0 | 2026-03-04 | 初始版本（品牌/产品定义/技术架构/Phase 0-10 路线图） |
| v1.1 | 2026-03-04 | 新增第零章（AI 开发规范）、Phase -1、7.11 版本范围、Section 32（架构决策） |
| v1.2 | 2026-03-04 | 新增二十一至二十八（版本迁移/法律/付费旅程/备份/支持/GTM/成本管理/可靠性） |
| v1.3 | 2026-03-04 | 修复重复章节编号、32.6 决策清单落地答案、AI 工期重估（6-10天）、新增三十一（FluxVita+Jowork 并行开发策略） |
| v1.4 | 2026-03-04 | 付费机制改为在线订阅（月付/年付），去掉 License Key/RSA；平台支持明确 Mac 优先+Windows 同步；premium 代码可公开 |

*最后更新：2026-03-04（v1.3）*
