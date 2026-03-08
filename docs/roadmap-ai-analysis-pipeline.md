# AI 数据分析 → 代码修复 Pipeline 开发规划

**目标场景**：员工在 AI Chat 里发起分析需求 → AI 自主查 PostHog + OSS 日志 → 输出完整分析报告 → 定位代码根因 → 修复 + 本地测试 → 自动提 PR 等待 Review。

**参考分析完整度**：`/Users/signalz/Downloads/user_analysis_report.md`（用户行为分析报告示例）

---

## 现状快照

| 能力 | 现状 |
|------|------|
| PostHog 查询 | 只有 dashboard/insight 摘要，无法按 user_id/事件/时间范围查询 |
| 阿里云 OSS | 未接入 |
| 阿里云 SLS 日志 | 未接入 |
| 代码读取 | ✅ GitLab mirror（本地 bare clone） |
| 代码写入 | ❌ 无 |
| 建 branch / 提 MR | ❌ GitLab connector 仅 GET |
| 本地运行测试 | ❌ 无 |
| 分析报告生成 | ⚠️ Agent 可以，但无专用格式 Prompt |

---

## Phase 1：数据接入层（必须先做）

> **核心阻塞**：没有数据，分析无从开始。

### 1.1 PostHog 深度查询工具

**新增 Agent 工具** `query_posthog`

```
用途：按条件实时查询 PostHog
支持：
  - 查询指定用户的事件列表（Events API）
  - 拉取用户 Profile（Persons API）
  - 查询漏斗/留存/趋势（Insights Query API）
  - 搜索特定事件（如 ws_error / purchase_flow_failed）的用户列表
```

**需要做的事**：
- `src/agent/tools/query_posthog.ts` — 新建工具，直接调 PostHog REST API
- 注册到 `src/agent/tools/registry.ts`
- 更新 Agent SYSTEM_PROMPT，描述工具用途和使用时机

**PostHog API 端点**：
- Events：`GET /api/projects/{id}/events?person_id=&event=&after=&before=`
- Persons：`GET /api/projects/{id}/persons?search=`
- Query：`POST /api/projects/{id}/query` (HogQL)

---

### 1.2 阿里云 OSS Connector

**新建 Connector** `aliyun-oss`

```
用途：读取 vida/monitor/ 下的会话日志 JSON 文件
支持：
  - 按 user_id 列出该用户的所有日志文件
  - 按时间范围过滤（文件名含日期）
  - 下载并解析单个日志文件内容
  - 批量拉取用户最近 N 天的日志
```

**需要做的事**：
- `src/connectors/aliyun-oss/index.ts` — 实现 `discover()` + `fetch()`
  - 使用阿里云 OSS Node.js SDK（`ali-oss`）
  - discover：列出 `vida/monitor/` 前缀的文件，索引进 `objects` 表
  - fetch：按 URI 下载具体文件
- `.env` 新增：`ALIYUN_OSS_ACCESS_KEY_ID` / `ALIYUN_OSS_ACCESS_KEY_SECRET` / `ALIYUN_OSS_BUCKET` / `ALIYUN_OSS_REGION`
- 注册到 `src/connectors/registry.ts`

---

### 1.3 阿里云 SLS 日志查询工具（可选，PostHog 能覆盖则跳过）

**新增 Agent 工具** `query_aliyun_logs`

> 当前状态：已接入基础能力（`resolve_only` / `check_config`），并支持 identity → `sls_user_id` 映射解析；
> 下一步可在此基础上扩展真实 SLS 检索查询。

```
用途：按 user_id / 时间范围查询阿里云日志服务
支持：SQL 风格查询，返回结构化日志条目
```

- 使用阿里云 SLS Node.js SDK
- `.env` 新增：`ALIYUN_SLS_ENDPOINT` / `ALIYUN_SLS_ACCESS_KEY_ID` / `ALIYUN_SLS_ACCESS_KEY_SECRET` / `ALIYUN_SLS_PROJECT` / `ALIYUN_SLS_LOGSTORE`

---

## Phase 2：分析能力层

### 2.1 数据分析 Skill

**新建 Skill** `user-behavior-analysis`

用途：Agent 在收到分析需求时，按固定结构输出完整报告。

**报告输出维度**（参考示例报告）：
1. 用户画像对比表（设备/地区/付费/健康目标/饮食偏好）
2. PostHog 关键事件统计表（事件名 / 次数 / 异常标注）
3. OSS 会话日志关键指标（AI 调用次数 / 用户主动发言 / 食物记录）
4. Chat 对话记录全文分析（逐条解读用户意图）
5. 关键发现 + 行动建议（P0/P1/P2 优先级标注）
6. 综合对比一览表

**实现方式**：
- `src/agent/tools/analyze_users.ts` — 调用 PostHog + OSS 工具，聚合数据
- 或：在 controller.ts SYSTEM_PROMPT 中添加分析模板
- 建议：写成独立 Skill，通过 Skills 执行器调用

### 2.2 多源数据 user_id 关联

不同系统的用户标识符不同：

| 系统 | 标识符 |
|------|--------|
| PostHog | `person_id`（UUID） |
| OSS 日志 | `jovida_uid`（数字 ID） |
| 阿里云 SLS | `user_id` |
| App 内 | `device_id`（UUID） |

**需要做的事**：
- DB 表 `user_id_mappings`：维护跨系统 ID 映射
- 管理接口：`GET/POST /api/system/id-mappings`（admin）
- Agent 在开始分析时，先查映射表，把请求中的 user 标识转换为各系统 ID

---

## Phase 3：代码修复链路

### 3.1 新增 Agent 工具：write_file

```typescript
// src/agent/tools/write_file.ts
// 功能：向本地代码仓库写入/修改文件内容
// 安全：只允许写入 data/repos/ 下的 GitLab 镜像目录
// 输入：project_id, file_path, content, commit_message
```

### 3.2 新增 Agent 工具：run_command

```typescript
// src/agent/tools/run_command.ts
// 功能：在沙箱内执行 shell 命令（跑测试/lint/build）
// 安全限制：
//   - 白名单命令（npm test / npx jest / flutter test / dart test 等）
//   - 超时 60s
//   - 工作目录固定在 data/repos/{project_id}/
//   - 不允许网络访问（可选：用 --offline 参数）
```

### 3.3 GitLab 写入 API 扩展

**扩展 GitLab connector**，新增写入方法：

```typescript
// src/connectors/gitlab/index.ts 新增：
createBranch(projectId, branchName, ref)
createOrUpdateFile(projectId, filePath, content, branchName, commitMsg)
createMergeRequest(projectId, sourceBranch, targetBranch, title, description)
```

所有写入都通过 GitLab API（已有 `GITLAB_TOKEN`），不需要本地 git。

### 3.4 新增 Agent 工具：create_gitlab_mr

```typescript
// src/agent/tools/create_gitlab_mr.ts
// 功能：在 GitLab 上创建 MR，通知相关人 review
// 输入：project_id, source_branch, title, description, assignee_id?
// 输出：MR URL
```

---

## Phase 4：端到端集成与提示词工程

### 4.1 更新 Agent SYSTEM_PROMPT

```
## 数据分析与代码修复能力

当用户提出数据分析需求时：
1. 先用 query_posthog 拉取目标用户/事件数据
2. 再用 fetch_content 读取 OSS 日志（URI格式：aliyun-oss://vida/monitor/{user_id}/）
3. 综合输出完整分析报告（按标准维度：用户画像 / 行为统计 / 发现 / 建议）
4. 如用户要求深入排查，read_code 读相关代码 → 定位根因
5. 修复：write_file 写入修改 → run_command 运行测试 → create_gitlab_mr 提 PR
```

### 4.2 Conversational 触发词识别

训练 Agent 识别分析意图的关键词：
- "分析 [用户A] 的使用数据"
- "为什么用户 [X] 流失了"
- "查一下 [event_name] 的用户有什么共同特征"
- "帮我排查 [bug描述]，找到原因并修复"

---

## 开发优先级与顺序

```
Week 1
  [P0] 1.1 PostHog 深度查询工具     ← 最快见效，数据已有
  [P0] 1.2 OSS Connector            ← 解锁会话日志这块大数据

Week 2
  [P1] 2.1 数据分析 Skill / Prompt  ← 有数据后立刻提升分析质量
  [P1] 2.2 user_id 跨系统映射       ← 让多源数据关联起来

Week 3
  [P1] 3.3 GitLab 写入 API          ← 为代码修复做准备
  [P1] 3.4 create_gitlab_mr 工具    ← PR 自动化

Week 4
  [P2] 3.1 write_file 工具          ← 代码修改
  [P2] 3.2 run_command 工具         ← 本地测试（安全设计最复杂）
  [P2] 4.1 端到端 SYSTEM_PROMPT     ← 串联全流程
  [P2] 1.3 SLS 日志查询             ← 按需添加
```

---

## 所需新增凭证（需 Aiden 提供）

| 凭证 | 用途 | 必须/可选 |
|------|------|---------|
| `ALIYUN_OSS_ACCESS_KEY_ID` | OSS 读取 | **必须** |
| `ALIYUN_OSS_ACCESS_KEY_SECRET` | OSS 读取 | **必须** |
| `ALIYUN_OSS_BUCKET` | OSS Bucket 名 | **必须** |
| `ALIYUN_OSS_REGION` | 如 oss-cn-hangzhou | **必须** |
| `POSTHOG_PROJECT_ID` | PostHog Events API | **必须** |
| `ALIYUN_SLS_ENDPOINT` | SLS 日志查询 | 可选 |
| `ALIYUN_SLS_PROJECT` | SLS 项目名 | 可选 |
| `ALIYUN_SLS_LOGSTORE` | SLS 日志库名 | 可选 |

> PostHog API Key 已有（`POSTHOG_API_KEY`），但需要确认是否有 Events/Persons API 的读权限（Private API Key）。

---

*规划日期：2026-03-03*
*下一步：从 Phase 1.1（PostHog 深度查询工具）开始*
