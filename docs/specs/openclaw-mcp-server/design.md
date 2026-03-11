# JoWork MCP Server — Technical Design

## Background & Goals

### 问题

OpenClaw 等个人 AI 助手的用户已经有了管理本地电脑、多渠道消息的能力，但缺少**结构化的团队数据访问**——飞书文档搜索、GitLab MR 创建、Linear issue 查询、PostHog 数据分析等。这些能力 JoWork Gateway 已经实现（15+ 工具），但只能通过 JoWork 自己的 chat UI 或飞书/Telegram 渠道使用。

### 目标

将 JoWork 的工具能力通过标准 MCP 协议暴露出去，让任何 MCP 客户端（OpenClaw、Claude Desktop、Cursor、Windsurf、Cline 等）都能直接调用 JoWork 的数据连接器和工具。

### 成功标准

1. OpenClaw 用户在 config 里加 3 行配置，即可在对话中搜飞书文档、查 GitLab issue
2. Claude Desktop 用户同样可用
3. 零侵入现有 Gateway 代码——MCP Server 是纯客户端，只调 Edge API

### 战略意义

- JoWork 成为 AI 助手生态中"团队数据"品类的标准插件
- 免费连自建 JoWork，连 FluxVita SaaS 需订阅（走现有 Stripe 计费）
- 每个 MCP 调用都经过 Gateway 的权限检查 + 成本追踪，商业模式天然兼容

---

## Technical Approach

### 架构总览

```
┌──────────────────────────────────────────────────┐
│  MCP Client (OpenClaw / Claude Desktop / Cursor) │
│       │ JSON-RPC (stdio or SSE)                  │
│       ▼                                          │
│  @jowork/mcp-server (npm package)                │
│       │ HTTP + JWT                               │
│       ▼                                          │
│  JoWork Gateway Edge API                         │
│  ├─ GET  /api/edge/tools    → tools/list         │
│  ├─ POST /api/edge/tool     → tools/call         │
│  ├─ POST /api/edge/session  → session mgmt       │
│  └─ POST /api/edge/messages → context persist    │
└──────────────────────────────────────────────────┘
```

**核心洞察**：Edge API 已经实现了工具发现（`GET /api/edge/tools`）+ 工具执行（`POST /api/edge/tool`）+ JWT 鉴权 + 权限过滤 + 成本追踪。MCP Server 只是一个**协议适配层**（JSON-RPC ↔ HTTP），不需要重复实现任何业务逻辑。

### 包结构

```
packages/mcp-server/
├── package.json          ← @jowork/mcp-server（bin 字段指向 dist/index.js）
├── tsconfig.json         ← 独立 tsconfig，不依赖根 paths alias
├── src/
│   ├── index.ts          ← 入口：解析 env → 选择 transport（stdio/SSE）→ 启动
│   ├── server.ts         ← MCP Server 实现（tools/list, tools/call, resources）
│   ├── gateway-client.ts ← Edge API HTTP 客户端 + session 管理
│   └── auth.ts           ← JWT 获取（直传 or username/password → /api/auth/local）
├── skill/
│   └── SKILL.md          ← OpenClaw 生态适配文件
└── README.md             ← 安装和配置说明
```

> Transport 层直接使用 `@modelcontextprotocol/sdk` 提供的 `StdioServerTransport` / `SSEServerTransport`，在 `index.ts` 中按 CLI 参数选择，不做额外封装。

> 已被 `pnpm-workspace.yaml` 的 `packages/*` 通配符自动覆盖，无需额外注册。

### MCP 协议实现

基于 `@modelcontextprotocol/sdk`（Anthropic 官方 MCP SDK），实现以下 MCP 能力：

#### 1. Tools（核心）

**工具列表动态获取，不硬编码**。MCP `tools/list` 请求时，实时调 `GET /api/edge/tools`，将 Gateway 返回的 `AnthropicToolDef[]` 转换为 MCP 格式（加 `jowork_` 前缀）。Gateway 新增/删除工具时 MCP Server 自动同步，零维护。

**命名规范**：所有工具加 `jowork_` 前缀，避免与其他 MCP server 的工具名冲突。Gateway 返回的 `search_data` → MCP 暴露为 `jowork_search_data`。

**示例输出**（取决于 Gateway 当前注册的工具和用户权限）：

```
tools/list → [
  { name: "jowork_search_data",    description: "全文搜索...", inputSchema: {...} },
  { name: "jowork_fetch_content",  description: "获取详情...", inputSchema: {...} },
  { name: "jowork_list_sources",   description: "列出数据源...", inputSchema: {...} },
  ... (Gateway 返回多少，这里就有多少，排除 local-only 工具)
]
```

**安全说明**：`run_query` 等高权限工具的安全性依赖 Gateway 侧的 RBAC + SQL 参数化查询。MCP Server 作为纯透传层，不做额外限制，也不需要——权限检查发生在 Gateway `POST /api/edge/tool` 处理链中。

```typescript
// server.ts — tools/list handler
async function handleToolsList(): Promise<McpTool[]> {
  const edgeTools = await gatewayClient.listTools();
  return edgeTools.map(t => ({
    name: `jowork_${t.name}`,
    description: t.description,
    inputSchema: t.input_schema,
  }));
}
```

> 注意：`GET /api/edge/tools` 已在 Gateway 侧过滤掉 local-only 工具（fs_read、fs_write、fs_edit、run_command、manage_workspace、web_search、web_fetch），MCP Server 不需要重复过滤。

#### 2. Resources（辅助）

| Resource URI | 说明 |
|-------------|------|
| `jowork://sources` | 已连接的数据源列表 |
| `jowork://health` | Gateway 健康状态 |

Resources 是只读信息，MCP 客户端可以在不调工具的情况下获取上下文。

#### 3. Prompts（可选，v2）

暂不实现。未来可加 `jowork://prompts/daily-summary` 等预设 prompt 模板。

### Session 生命周期

MCP 协议没有 session 概念，但 Edge API 的 `POST /api/edge/tool` 强制要求 `session_id`。设计决策：

- **一个 MCP Server 进程 = 一个 Edge Session**
- MCP Server 启动时（`connect()` 阶段）调 `POST /api/edge/session` 创建 session，缓存 `session_id`
- 所有后续 `tools/call` 共用此 session
- 如果 `tools/call` 收到 403（session 无效），自动调 `POST /api/edge/session` 重建 session 并重试一次
- 进程退出时 session 自然过期（不需要显式关闭）

这样 MCP 调用产生的工具历史也会记录在 Gateway 的 session 中，未来可在 JoWork chat UI 查看。

### Gateway Client

```typescript
// gateway-client.ts
class GatewayClient {
  private baseUrl: string;    // e.g. "https://jowork.work" or "http://localhost:18800"
  private jwt: string;
  private sessionId: string = '';

  /** 连接 Gateway：验证健康 + 创建 session */
  async connect(): Promise<void> {
    await this.health();  // 验证 Gateway 可达
    await this.ensureSession();
  }

  /** 创建或重建 Edge session */
  private async ensureSession(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/edge/session`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'MCP Server session' }),
    });
    if (!res.ok) throw new Error(`Failed to create session: ${res.status}`);
    const data = await res.json();
    this.sessionId = data.session_id;
  }

  async listTools(): Promise<AnthropicToolDef[]> {
    const res = await fetch(`${this.baseUrl}/api/edge/tools`, {
      headers: { Authorization: `Bearer ${this.jwt}` },
    });
    return res.json();
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<string> {
    const res = await fetch(`${this.baseUrl}/api/edge/tool`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, input, session_id: this.sessionId }),
    });

    // Session 过期 → 自动重建并重试一次（仅限 session 失效，权限 403 直接抛出）
    if (res.status === 403) {
      const data = await res.json();
      if (data.error === 'Invalid session') {
        await this.ensureSession();
        return this.executeTool(name, input);  // 重试
      }
      throw new Error(data.error || 'Permission denied');
    }

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Tool ${name} failed`);
    return typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
  }

  async health(): Promise<{ ok: boolean; version: string }> {
    const res = await fetch(`${this.baseUrl}/health`);
    return res.json();
  }
}
```

### 认证方式

支持两种认证模式：

**模式 1：JWT 直传**（推荐）
```json
{
  "jowork": {
    "command": "npx",
    "args": ["@jowork/mcp-server"],
    "env": {
      "JOWORK_URL": "https://jowork.work",
      "JOWORK_TOKEN": "<JWT token>"
    }
  }
}
```

**模式 2：用户名密码自动获取 JWT**（开启 local auth 时）
```json
{
  "jowork": {
    "command": "npx",
    "args": ["@jowork/mcp-server"],
    "env": {
      "JOWORK_URL": "https://jowork.work",
      "JOWORK_USERNAME": "admin",
      "JOWORK_PASSWORD": "xxx"
    }
  }
}
```

MCP Server 启动时调 `POST /api/auth/local` 获取 JWT，之后缓存使用。

**模式 3：API Key（v2）**
未来考虑在 Gateway 增加长期有效的 API Key 机制（类似 Personal Access Token），比 JWT 更适合 MCP 场景。

### Transport 层

**stdio**（默认）：
- 适用于 Claude Desktop、OpenClaw、Cursor 等通过 `command` 启动 MCP server 的客户端
- 进程生命周期由客户端管理
- 零配置，开箱即用

**HTTP**（可选，`--transport http --port 3100`）：
- 适用于 Web 客户端或需要长期运行的场景
- 使用 MCP SDK 提供的 Streamable HTTP transport（SDK ≥2025.03 版本；旧版回退到 SSE transport）

---

## Key Flows

### Flow 1: 用户首次配置

```
1. 用户部署 JoWork Gateway（或注册 jowork.work SaaS）
2. 获取 JWT token（登录后从浏览器 DevTools 复制，或用 API）
3. 在 MCP 客户端配置文件中添加 jowork server：
   - Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json
   - OpenClaw: ~/.openclaw/mcp.json
   - Cursor: .cursor/mcp.json
4. 重启 MCP 客户端
5. MCP Server 启动 → 调 /health 验证连接 → 调 /api/edge/session 创建会话 → 调 /api/edge/tools 获取工具列表
6. 用户在对话中可直接使用 "搜索飞书文档"、"创建 GitLab MR" 等
```

### Flow 2: 工具调用完整链路

```
用户(OpenClaw): "帮我搜一下飞书里关于 Q2 OKR 的文档"
  │
  ▼ OpenClaw Agent 识别意图，构造 tool_use
MCP Client → JSON-RPC request:
{
  "method": "tools/call",
  "params": {
    "name": "jowork_search_data",
    "arguments": { "query": "Q2 OKR", "source_type": "feishu" }
  }
}
  │
  ▼ @jowork/mcp-server 处理
1. 去掉 jowork_ 前缀 → tool name = "search_data"（jowork_search_data → search_data）
2. POST /api/edge/tool { name: "search_data", input: { query: "Q2 OKR", source_type: "feishu" } }
3. Gateway 执行：RBAC 检查 → FTS 搜索 objects 表 → 返回结果
  │
  ▼ MCP Server 返回
JSON-RPC response:
{
  "result": {
    "content": [{ "type": "text", "text": "找到 3 个相关文档:\n1. ..." }]
  }
}
  │
  ▼ OpenClaw Agent 将结果组织成自然语言回复用户
```

### Flow 3: 权限不足

```
MCP tools/call → POST /api/edge/tool
Gateway 返回 403: { error: "No access to tool: create_gitlab_mr" }
MCP Server → JSON-RPC error response:
{
  "error": { "code": -32603, "message": "Permission denied: create_gitlab_mr requires 'developer' role" }
}
Agent 告知用户权限不足，建议联系管理员
```

### Flow 4: Gateway 不可达

```
MCP Server 启动 → fetch(/health) 超时
→ 写 stderr 日志: "Cannot connect to JoWork Gateway at https://jowork.work"
→ tools/list 返回空数组（graceful degradation）
→ 后续调用自动重试连接（指数退避，最大 5 分钟）
```

---

## Edge Cases & Risks

### 1. JWT 过期

- **风险**：JWT 默认 7 天有效，长期运行的 MCP Server 会遇到 401
- **方案**：收到 401 时，如果配置了 username/password，自动重新获取 JWT；否则 stderr 提示用户更新 token
- **v2 方案**：Gateway 增加 API Key 机制（不过期）

### 2. 工具名冲突

- **风险**：用户同时配了多个 MCP server，工具名可能冲突
- **方案**：`jowork_` 前缀 + 工具名动态从 Gateway 获取（不硬编码）

### 3. 大量数据返回

- **风险**：`search_data` 可能返回大量结果，超出 MCP 客户端的 context 限制
- **方案**：Gateway 已有分页（默认 limit=20），MCP Server 透传不做额外限制

### 4. 网络延迟

- **风险**：MCP 客户端对工具调用有超时限制（通常 30-60 秒）
- **方案**：Edge API 的 `POST /api/edge/tool` 本身有超时保护；MCP Server 设 60 秒 fetch timeout

### 5. 并发调用

- **风险**：某些 MCP 客户端可能并发调用多个工具
- **方案**：GatewayClient 无状态（每次请求独立），天然支持并发

### 6. OpenClaw 不原生支持 MCP

- **现状**：OpenClaw 用 Skill + Plugin 机制，不直接支持 MCP
- **方案**：
  1. 发布 `@jowork/mcp-server` npm 包，先覆盖 Claude Desktop / Cursor / Cline 等 MCP 原生客户端
  2. 为 OpenClaw 提供 SKILL.md 适配（通过 shell 调用 `npx @jowork/mcp-server` 的 CLI 模式）
  3. 长期推动 OpenClaw 社区增加 MCP 客户端支持（趋势所向）

### 7. 安全：Token 泄露

- **风险**：JWT 存在 MCP 配置文件中（明文）
- **缓解**：
  - 配置文件权限 600
  - README 强调不要提交到 git
  - v2 支持 keychain 集成（macOS `security find-generic-password`）

---

## Task Breakdown

### Phase 1: 核心 MCP Server（MVP）

- [ ] **Task 1**: 创建 `packages/mcp-server/` 包结构（`package.json` + `tsconfig.json`），依赖 `@modelcontextprotocol/sdk`（Anthropic 官方 MCP SDK）+ `typescript`，配置 `bin` 字段指向编译后入口
- [ ] **Task 2**: 实现 `GatewayClient` 类（`src/gateway-client.ts`）——HTTP 客户端封装 Edge API 四端点（`POST /api/edge/session`、`GET /api/edge/tools`、`POST /api/edge/tool`、`GET /health`），包含 JWT 注入、超时 60s、session 生命周期管理（`connect()` 创建 session，403 自动重建并重试一次）
- [ ] **Task 3**: 实现 `src/auth.ts`——两种认证模式：直传 JWT（`JOWORK_TOKEN` env）或自动获取（`JOWORK_USERNAME` + `JOWORK_PASSWORD` → `POST /api/auth/local`），JWT 缓存 + 401 刷新
- [ ] **Task 4**: 实现 `src/server.ts` MCP Server 核心——使用 `@modelcontextprotocol/sdk` 的 `Server` 类，注册 `tools/list`（动态从 Gateway 获取 + 加 `jowork_` 前缀）和 `tools/call`（去前缀 + 调 `GatewayClient.executeTool`）处理器
- [ ] **Task 5**: 实现 `src/index.ts` 入口——解析 env（`JOWORK_URL` 必填、`JOWORK_TOKEN` 或 `JOWORK_USERNAME`+`JOWORK_PASSWORD` 二选一），直接使用 SDK 的 `StdioServerTransport`（默认）或 `SSEServerTransport`（`--transport http --port 3100`），调 `gatewayClient.connect()` 初始化连接 + 创建 session，stderr 输出启动日志
- [ ] **Task 6**: 本地验证——用 `npx @modelcontextprotocol/inspector` 连接 MCP Server，验证 `tools/list` 返回工具列表、`tools/call` 执行 `jowork_search` 返回结果

### Phase 2: 生态适配

- [ ] **Task 7**: 编写 `README.md`——包含 Claude Desktop / Cursor / OpenClaw 三种客户端的配置示例、环境变量说明、Troubleshooting
- [ ] **Task 8**: 创建 OpenClaw SKILL.md 适配文件（`packages/mcp-server/skill/SKILL.md`）——描述 JoWork 能力、安装方式（`npm i -g @jowork/mcp-server`）、配置方式，符合 OpenClaw skill 元数据格式（`requires.bins: ["node"]`、`requires.env: ["JOWORK_URL", "JOWORK_TOKEN"]`）
- [ ] **Task 9**: 添加 `resources/list` + `resources/read` 支持——暴露 `jowork://sources`（数据源列表）和 `jowork://health`（Gateway 状态）两个 MCP Resource

### Phase 3: 健壮性 + 发布

- [ ] **Task 10**: 连接恢复机制——Gateway 不可达时 `tools/list` 返回空 + stderr 警告，后台指数退避重试（1s → 2s → 4s → ... → 5min），恢复后自动刷新工具列表
- [ ] **Task 11**: 添加 HTTP transport 支持——`--transport http --port 3100` CLI 参数，使用 `@modelcontextprotocol/sdk` 的 Streamable HTTP transport（或旧版 `SSEServerTransport`，取决于 SDK 版本），适用于 Web 客户端场景
- [ ] **Task 12**: 发布到 npm——`npm publish` 为 `@jowork/mcp-server`，确保 `npx @jowork/mcp-server` 可直接运行；README 推荐 `npm i -g @jowork/mcp-server` 全局安装以避免 `npx` 冷启动延迟（10+ 秒可能触发 MCP 客户端超时）

### Phase 4: Gateway 侧增强（可选，v2）

- [ ] **Task 13**: Gateway 增加 API Key 机制——`POST /api/auth/api-keys`（创建）、`DELETE /api/auth/api-keys/:id`（吊销），API Key 不过期、绑定用户角色，解决 JWT 过期问题
- [ ] **Task 14**: Gateway 增加 `/api/edge/tools` 的 `Accept: text/event-stream` 支持——工具列表变更时推送更新（MCP `notifications/tools/list_changed`），实现工具热更新

---

## Out of Scope

以下不在本迭代范围内：

1. **OpenClaw Plugin 开发** — OpenClaw 的 `extensions/` 插件系统需要 Go/Node 特定格式，等社区加 MCP 支持后不再需要
2. **MCP Prompts** — 预设 prompt 模板（如 `daily-summary`），留给 v2
3. **MCP Sampling** — 让 MCP Server 反向调用客户端的 LLM 能力，当前不需要
4. **双向会话同步** — MCP 调用产生的上下文不同步回 JoWork chat UI，留给 v2
5. **多 Gateway 支持** — 一个 MCP Server 实例只连一个 Gateway，多个 Gateway 需起多个实例
6. **工具级别的流式输出** — MCP 工具返回完整结果，不做流式（MCP 协议本身不支持工具流式输出）
7. **前端 UI** — 不做配置界面，纯 CLI + env 配置
