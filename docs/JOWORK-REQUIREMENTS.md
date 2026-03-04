# Jowork 完整需求文档

> 版本：v1.1 | 日期：2026-03-04
> 从多轮对话中还原，覆盖产品、技术、商业、运营全部需求。
> 如有遗漏或偏差，请直接修改本文档。

---

## 一、产品定位

### 核心是什么

一个 **24 小时在线的 AI 同事**。

不是聊天机器人，不是搜索工具——是真正能「干活」的 AI：连接你的所有数据源和工作流，既能被动回答问题，也能主动执行任务。用户感知上，它更接近「雇了一个永不下班的助理」，而不是「用了一个更聪明的搜索框」。

### 产品名与品牌

- **产品线**：Jo 系列（Joy = 让工作和生活更 joyful）
  - **Jowork**（Joy of Work）：AI 同事平台，面向个人开发者和团队，**本文档主题**
  - **Jovida**（Joy of Vida）：个人生活教练 App，面向海外 C 端，独立产品线
- **主理公司**：FluxVita（维塔流动）
- **GitHub 组织**：`fluxvita`
- **仓库**：`github.com/fluxvita/jowork`
- **官网**：`jowork.work`
- **Slogan**：_"Your AI coworker that actually knows your business."_

### 与竞品的本质区别

| 维度 | ChatGPT / Notion AI | Dust.tt / Glean | **Jowork** |
|------|---------------------|-----------------|------------|
| 业务上下文 | 无 | 有，只读 | **深度连接 + 可写可操作** |
| 主动性 | 被动问答 | 被动问答 | **定时 + 事件触发 + 目标驱动** |
| 部署方式 | SaaS only | SaaS only | **自部署（本地/私有服务器）** |
| 执行力 | 只能对话 | 只能查数据 | **Claude Code 级别的执行力** |
| 数据主权 | 厂商持有 | 厂商持有 | **100% 在用户自己手里** |

---

## 二、目标用户

### 开源冷启动阶段（v0.1）

- **独立开发者 / 技术 Founder**：有自部署能力，愿意折腾，社区传播力强，是 GitHub Star 和口碑的核心来源
- **小团队 CTO / 技术负责人**：3-20 人团队，想低成本给团队装一个 AI 助手，不想付高昂 SaaS 费用

### 商业化阶段（v0.2+）

- **知识工作者**：设计师、PM、分析师，需要通过 Onboarding 降低使用门槛
- **中型公司技术团队**：50-200 人，需要权限管理、审计日志、合规能力

---

## 三、部署模式

三种模式，v1 必须完整支持前两种：

### Personal 模式
- **场景**：个人开发者，全部跑在自己电脑上
- **架构**：Tauri 桌面 App 内置 Gateway sidecar（Bun compile 单文件），WebView 直连本地 `127.0.0.1:9800`
- **体验目标**：像打开 VS Code 一样——安装完直接用，无需任何服务器配置
- **无需登录**：首次启动直接进主界面，数据存在 OS 标准路径（`~/Library/Application Support/Jowork/`）
- **付费**：平台功能永远免费；如果使用 Jowork 提供的托管模型服务，按用量付费

### Team 模式
- **场景**：小公司，一台服务器 + 多个员工客户端
- **架构**：独立 Gateway 进程（Linux 服务器 / Docker），Tauri 客户端通过 mDNS 或 Cloudflare Tunnel 连接
- **访问方式**：局域网自动发现（mDNS）+ 扫码连接 + Cloudflare Tunnel 远程访问
- **认证**：JWT，多用户 RBAC

### Enterprise 模式（v2 远期）
- SSO / SAML、审计日志、合规、多部门隔离

---

## 四、平台支持

| 平台 | 优先级 | 说明 |
|------|--------|------|
| **macOS Apple Silicon** | P0，优先 | 主力开发平台，每个版本完整 QA |
| **macOS Intel** | P0 | 通用二进制（Universal Binary）一起打包 |
| **Windows 11/10** | P1，同步支持 | Tauri + WebView2，CI 自动构建，smoke test 通过 |
| **Linux** | P2，社区支持 | Docker 路径已覆盖，桌面 App 社区自行打包 |
| **Docker** | P0 | `docker run` 一行命令，面向服务器部署场景 |

---

## 五、核心功能需求

### 5.1 连接一切（Connector 体系）

用户可以把 Jowork 连接到他们所有的工具上，Jowork 持续同步和索引这些数据：

**首发连接器（v0.1 必须）**：

> 选型标准：硅谷互联网公司常用办公软件 + OpenClaw 已覆盖范围。**认证方式优先 SSO / OAuth，避免 token 手动输入。**

| 分类 | Connector | 认证方式 |
|------|-----------|---------|
| 代码 | **GitHub** | OAuth |
| 代码 | **GitLab** | OAuth |
| 项目管理 | **Linear** | OAuth |
| 项目管理 | **Jira** | OAuth (Atlassian) |
| 通讯 | **Slack** | OAuth |
| 通讯 | **Lark / 飞书** | OAuth |
| 通讯 | **Discord** | OAuth |
| 文档 | **Notion** | OAuth |
| 文档 | **Google Drive** | OAuth (Google SSO) |
| 文档 | **Confluence** | OAuth (Atlassian) |
| 日历 & 邮件 | **Google Calendar / Gmail** | OAuth (Google SSO) |
| 日历 & 邮件 | **Outlook / Microsoft 365** | OAuth (Microsoft SSO) |
| 设计 | **Figma** | OAuth |
| 数据分析 | **PostHog** | API Key（无 OAuth，业界标准） |
| CI/CD | **GitHub Actions** | 随 GitHub OAuth |

**认证优先级规则**：
1. **SSO / OAuth**：首选，用户点击授权即完成，无需复制粘贴 token
2. **API Key**：仅当该服务官方不提供 OAuth 时才使用（如 PostHog）
3. 永远不做 username + password 登录

**连接器标准（Jowork Connect Protocol，JCP）**：
- 统一接口：`discover()` + `fetch()` + `health()` + 可选 `write()` + 可选 `subscribe()`
- OAuth 优先认证
- Connector 以 npm 包形式发布（`@jowork/connector-{name}`）
- 第三方开发者可以发布自己的 Connector

### 5.2 深度上下文（三层体系）

Jowork 的差异化核心——Agent 对业务的理解程度远超普通 AI 工具：

```
公司层（Company Context）
  ├─ 公司简介、产品定位、核心价值观
  ├─ 技术架构文档、术语表
  └─ 所有 Connector 同步的数据（代码、任务、消息、文档）

团队层（Team Context）
  ├─ 团队 OKR、工作流程
  ├─ 沟通偏好、Review 规范
  └─ 团队专属 Connector 数据

个人层（Personal Context）
  ├─ 工作方式文档（我喜欢怎么沟通、我的常见任务）
  ├─ 个人待办、日历、邮件
  └─ Agent 记忆（过去的对话和决策）
```

### 5.3 自主 Agent

不只是问答，而是能主动干活：

- **被动模式**：用户问 → Agent 答，可调用工具（读代码、查任务、搜文档）
- **定时任务**："每周一早上总结上周 PR"
- **事件触发**："Linear 出现 P0 bug 时，自动 ping 值班工程师并起草修复方案"（Premium）
- **目标驱动**："监控我们的转化率，下降 10% 时告警"（Premium）
- **代码执行**：Shell 命令（白名单机制）、创建 PR、发消息

### 5.4 极客模式（Geek Mode）

面向开发者的高级能力：

- **集成终端**：xterm.js + PTY，等同 VS Code 终端体验
- **Shell 执行**：白名单机制，可执行批准的命令
- **MCP 协议**：接入任何 MCP 兼容工具
- **自定义 Skills**：用 JS 编写自己的 Agent 行为

> **Free 版包含基础终端**（这是开源社区的核心吸引力，不能砍）
> 高级终端功能（多 pane、SSH 管理等）在 **Team 及以上版本**解锁

### 5.5 记忆系统

- 语义向量搜索（embedding + cosine similarity）
- FTS5 全文检索（关键词降级方案）
- 跨会话持久化（用户的偏好、历史决策不会丢失）
- 用户可查看、编辑、删除记忆（数据主权）

---

## 六、付费模式（双维度）

> **核心逻辑**：平台功能 和 模型使用 是两件独立的事，分开计费。

### 维度 A：平台功能订阅

为平台的高级功能付费（多用户、更多 Connector、更大上下文等）：

| 档位 | 月价 | 年价 | 核心权益 | 目标用户 |
|------|------|------|---------|---------|
| **Free** | $0 | $0 | 3 个 Connector，1 用户，32K 上下文，基础终端 | 个人开发者，永久可用 |
| **Pro** | $15 | $12 | 10 个 Connector，1 用户，100K 上下文，全功能终端 | 重度个人用户 |
| **Team** | $49 | $39 | 无限 Connector，10 用户，事件触发，Sub-agent | 小团队 |
| **Business** | $199 | $159 | 无限用户，SSO，审计日志，SLA，专属支持 | 中型公司 |

**Personal 模式**：平台功能**永远 Free**，无需订阅。

### 维度 B：模型积分订阅（类 Manus 模式）

为 Jowork 提供的托管 AI 模型服务付费（**可选**，用自己 API Key 则免费）：

**模型托管平台**：OpenRouter（统一路由多家模型，灵活切换）

**积分订阅档位**（月付/年付均可，引导方向：年付 + Max）：

| 档位 | 月价 | 年价（月均） | 月积分额度 | 核心权益 |
|------|------|------------|-----------|---------|
| **Pro** | ~$15 | ~$12/月 | 基础积分包 | 常用模型，适合日常使用 |
| **Max** | ~$39 | ~$30/月 | 中等积分包 | 更多模型选择，**主推档位** |
| **Ultra** | ~$99 | ~$79/月 | 大额积分包 | 旗舰模型无限制，重度用户 |

**积分定价逻辑**：
- 每档积分额度以 OpenRouter token 成本 + **约 20% 利润率** 定价
- 选择不同模型（GPT-4o vs Claude Haiku vs Gemini Flash）消耗积分速率不同
- 用户每次调用可看到本次消耗积分数
- 积分当月有效，不累计（与 Manus 一致）

**方式总览**：
| 方式 | 费用 | 适合谁 |
|------|------|--------|
| **BYOK（自带 API Key）** | $0 模型费 | 有 Anthropic/OpenAI 账号的用户 |
| **积分订阅 Pro** | ~$15/月 | 轻度使用者 |
| **积分订阅 Max** | ~$39/月 | 主流用户（主推） |
| **积分订阅 Ultra** | ~$99/月 | 重度/团队用户 |

**Personal 模式与账号**：
- Personal 模式使用 BYOK：无需 jowork.work 账号，完全本地
- Personal 模式使用托管模型：**必须注册 jowork.work 账号**（计费必要），App 内引导注册流程

**关键原则**：
- 两个维度完全解耦，可以任意组合
- Personal 用户用自己 key：总费用 $0，无需注册
- Personal 用户用 Jowork 模型：只付积分订阅，不付平台功能费
- Team 用户用自己 key：只付 Team 功能订阅，不付模型费
- Team 用户用 Jowork 模型：Team 功能订阅 + 积分订阅（独立计费）

**计费渠道**：
- Phase 1：Stripe（订阅 + 用量计费，企业信任度高）
- Phase 2：Paddle（欧洲 VAT 合规）
- Phase 3：支付宝 / 微信（中国市场）

---

## 七、开源策略

### 开源协议

| 代码范围 | 协议 | 说明 |
|---------|------|------|
| `packages/core` | **AGPL-3.0** | 完全开源，修改必须回馈社区 |
| `packages/premium` | **商业协议** | **代码公开可审计**，但未订阅不可商用 |
| `apps/jowork` | **AGPL-3.0** | 开源版桌面 App |
| `apps/fluxvita` | 私有 | FluxVita 内部定制版，不公开 |

> Premium 代码公开的理由：企业客户要看到代码才信任，透明度是竞争优势。

### 仓库关系

```
本地 fluxvita_allinone（私有，GitLab）
  └── monorepo-migration 分支 → 开发 Jowork 结构
  └── master 分支 → FluxVita 日常开发

GitHub fluxvita/jowork（公开）
  └── 开源部分的镜像（packages/core + packages/premium + apps/jowork）
  └── 用户下载这个可以运行完整的 Jowork 产品
```

### 贡献者规则

- CLA 签署（CLA Assistant）
- AGPL-3.0 贡献必须开源
- 多 AI 协作：AGENTS.md 规范（任务认领 + 防冲突）

---

## 八、技术架构（已锁定）

### 技术栈

| 层 | 技术 | 状态 |
|----|------|------|
| 运行时 | Node.js 22+ | 锁定 |
| 语言 | TypeScript（strict） | 锁定 |
| 服务框架 | Express 5 | 锁定 |
| 数据库 | SQLite + better-sqlite3 + FTS5 | 锁定 |
| 桌面端 | Tauri 2（Rust） | 锁定 |
| Gateway 二进制 | Bun `--compile`（单文件 sidecar） | 锁定 |
| 前端 | Vue 3（CDN，无构建步骤） | 锁定 |
| 包管理器 | pnpm workspaces | 锁定 |
| 模型路由 | 优先用户自带 Key，降级 Jowork 托管 | 锁定 |

### Monorepo 结构（目标）

```
jowork/
  packages/
    core/       ← @jowork/core，AGPL-3.0
    premium/    ← @jowork/premium，商业协议，代码公开
  apps/
    jowork/     ← 开源 Tauri App
    fluxvita/   ← FluxVita 专属（私有，不进公开 GitHub）
  docs/
  scripts/
```

### 已拍板的架构决策

| 决策 | 结论 |
|------|------|
| Gateway 打包方式 | Bun `--compile`，单文件 ~5MB |
| 前端框架 | Vue 3 CDN，渐进引入，无构建步骤 |
| Personal 模式登录 | 无需登录 |
| 数据目录 | OS 标准路径（`~/Library/Application Support/Jowork/`） |
| Free 版终端 | 包含基础终端 |
| 付费机制 | 在线订阅（Stripe），无 License Key |

---

## 九、GTM 策略

### 发布三阶段

```
Phase A：定向内测（v0.1-alpha）
  ← 10-20 个邀请：独立开发者 + 技术 Founder
  ← 私有 Discord，收集反馈，修 critical bug

Phase B：公开 Beta（v0.1-beta）
  ← GitHub 仓库公开
  ← Reddit（r/selfhosted、r/LocalLLaMA）
  ← Hacker News Show HN
  ← Product Hunt Launch

Phase C：正式发布（v0.1.0）
  ← 官网 + Pricing 页上线
  ← 开始接受付费订阅
  ← 持续内容营销
```

### 冷启动里程碑

| 时间点 | 目标 |
|--------|------|
| 发布后 1 周 | 500 GitHub Stars |
| 发布后 1 月 | 2,000 Stars + 100 活跃用户 |
| 发布后 3 月 | 5,000 Stars + 500 用户 + 20 付费用户 |
| 发布后 6 月 | 10,000 Stars + 2,000 用户 + 100 付费用户（MRR ~$2,000）|

### 语言支持

- **官网 jowork.work**：英文 + 中文（双语，中文不是翻译凑合，要做到原生中文体验）
- **README**：英文主版本 + 中文版本（`README_CN.md` 或切换语言）
- **文档**：英文优先，中文跟进

### 社区渠道

- **主渠道：GitHub Discussions**（与代码仓库一体，开发者文化）
- **辅渠道：Discord**（实时讨论，后期再建，冷启动不优先）

### SEO 关键词

- self-hosted AI assistant
- AI coworker open source
- Dust.tt alternative self-hosted
- Glean for small teams open source
- run AI agent on your own server

---

## 十、安全 & 合规需求

- **数据加密**：AES-256-GCM（Connector 凭据存储）
- **权限模型**：RBAC，4 角色：`owner / admin / member / guest`
- **Context PEP**：Agent 输出前过滤敏感数据
- **GDPR / CCPA**：用户数据本地存储，Cloudflare Analytics（无 cookie）
- **法律文档**：ToS、Privacy Policy、AGPL 合规 FAQ、退款政策
- **CLA**：贡献者签署 CLA

---

## 十一、性能目标

- **并发**：100 用户同时使用，单台 Mac mini M4（8 核）
- **响应时间**：非 LLM 调用 P95 < 200ms
- **全文搜索**：FTS5，< 100ms
- **启动时间**：桌面 App 冷启动 < 3 秒（含 sidecar 启动）
- **内存**：Gateway 进程 < 500MB

---

## 十二、开发模式（AI 驱动）

- 全程 AI 写代码（Claude Code），人工负责决策 / 审查 / 测试
- 工期估算：6-10 个工作日（AI 驱动）
- 多 AI 并行：AGENTS.md 规范防止冲突
- Phase DoD（每个 Phase 完成标准）：`pnpm lint` + `pnpm test` + `cargo check` 全绿
- FluxVita 和 Jowork 并行开发：`monorepo-migration` 分支隔离，不影响 FluxVita master

---

## 十三、决策记录

> 所有关键决策已拍板（2026-03-04），可进入开发阶段。

| # | 问题 | 决策结果 |
|---|------|---------|
| 1 | 模型托管计费方式 | **积分订阅（Pro/Max/Ultra）**，月付+年付，OpenRouter 托管，20% 利润率，引导年付 Max |
| 2 | Personal 模式账号 | **引导注册** jowork.work 账号；BYOK 无需注册，使用托管模型必须注册 |
| 3 | v0.1 首发 Connector | **GitHub、GitLab、Linear、Jira、Slack、飞书、Discord、Notion、Google Drive、Confluence、Gmail/Calendar、Outlook、Figma、PostHog、GitHub Actions**；认证优先 SSO/OAuth |
| 4 | Geek Mode 高级终端 | **Team 及以上**解锁多 pane / SSH 管理 |
| 5 | 官网语言 | **双语**（英文 + 中文），README 同步提供中文版 |
| 6 | 社区主渠道 | **GitHub Discussions**，Discord 后期再建 |

---

*本文档由 Claude Code 从对话记录中整理，如有遗漏请直接补充。*
*最后更新：2026-03-04（v1.1：6 个待决策项全部拍板，Connector 名单、积分定价、SSO 优先策略、双语支持已写入）*
