# Review Log — JoWork MCP Server

<!-- Append-only. Each round appends new content. Never modify existing entries. -->

## [Architect] Round 1

### Issues

**[Blocking] Session 生命周期未定义**

`POST /api/edge/tool` 要求 `session_id` 且不可为空（edge.ts:120: `if (!name || !session_id)` → 400）。设计文档的 `GatewayClient` 代码引用了 `this.sessionId` 但未说明何时创建、何时复用。

MCP 协议没有 session 概念。需要在设计中明确：
- 方案建议：MCP Server 启动时调 `POST /api/edge/session` 创建一个 session，生命周期 = 进程生命周期。所有 `tools/call` 共用此 session。
- 在 `GatewayClient` 构造函数或 `connect()` 方法中完成 session 创建。
- `tools/call` 失败时如果是 session 过期（403 Invalid session），自动重建 session。

**[Blocking] 工具映射表与动态获取逻辑矛盾**

设计中同时有：
1. 硬编码的 12 行工具映射表（jowork_search → search_data 等）
2. 动态获取逻辑（`tools/list` 实时调 Gateway，自动加前缀）

两者互相矛盾。如果是动态获取（代码正确），那映射表应明确标注为"示例/参考"而非规范定义，否则实现者会困惑该以哪个为准。

**建议**：删除固定映射表，改为一段说明文字 + 示例输出，明确"工具列表由 Gateway 动态返回，MCP Server 不硬编码"。

### Suggestions

**[Non-blocking] Transport 文件过度封装**

`transports/stdio.ts` 和 `transports/sse.ts` 只是对 SDK 提供的 `StdioServerTransport` 和 `SSEServerTransport` 的薄包装。建议直接在 `index.ts` 中使用 SDK 类，不需要单独的 transport 文件。减少 2 个文件 = 更简单。

```
packages/mcp-server/src/
├── index.ts          ← 入口 + transport 选择
├── server.ts         ← MCP Server 核心
├── gateway-client.ts ← Edge API 客户端
└── auth.ts           ← 认证
```

**[Non-blocking] Task 13（pnpm workspace 注册）应提前到 Task 1**

当前 `pnpm-workspace.yaml` 已配置 `packages/*` 通配符，所以 `packages/mcp-server/` 会被自动识别，Task 13 实际上不需要。建议在 Task 1 中备注"已被 workspace 通配符覆盖，无需额外注册"，删除 Task 13。

**[Non-blocking] `npx` 冷启动延迟**

`npx @jowork/mcp-server` 首次运行需要下载包，可能 10+ 秒。部分 MCP 客户端（如 Claude Desktop）对 server 启动有超时限制。建议 README 中推荐 `npm i -g @jowork/mcp-server` 全局安装，`npx` 作为备选。

**[Non-blocking] `run_query` 安全风险**

`run_query` 允许任意 SQL 查询，通过 MCP 暴露给外部客户端增加了攻击面。Gateway RBAC 已经限制了谁能用这个工具，但建议在 Edge Cases 章节补充说明：依赖 Gateway 侧的 RBAC + SQL sanitization，MCP Server 不做额外限制。

**[Non-blocking] MCP SDK 版本注意**

MCP 协议最新版本（2025-03）新增了 Streamable HTTP transport，可能替代 SSE。Task 11 中提到的 `SSEServerTransport` 需要确认 SDK 版本是否仍支持。建议 Task 11 改为"添加 HTTP transport 支持（SSE 或 Streamable HTTP，取决于 SDK 版本）"。

### Confirmations

（首轮评审，无前轮问题需确认）

## [Architect] Round 2

### Issues

（无 blocking issue）

### Suggestions

**[Non-blocking] Flow 2 工具名与命名规范不一致**

命名规范（line 77）明确说"Gateway 返回的 `search_data` → MCP 暴露为 `jowork_search_data`"，但 Flow 2（line 273）仍写 `jowork_search`。应改为 `jowork_search_data` 保持一致。

**[Non-blocking] 403 重试需区分 session 失效 vs 权限不足**

`executeTool` 收到 403 时一律重建 session 并重试。但 Gateway 对"session 无效"和"工具无权限"都返回 403。建议检查 error body：仅当 `data.error` 包含 "Invalid session" 时才重试，其他 403 直接抛出。当前逻辑不会死循环（只重试一次），但权限 403 会多一次无意义的 session 创建。

**[Non-blocking] Task 编号跳跃**

删除 Task 13 后，Phase 4 的编号从 14 开始。建议重编号为 Task 13、14（纯美观）。

### Confirmations

- Session 生命周期已完整定义（connect → ensureSession → 共用 sessionId → 403 重建） ✅
- 工具映射表已替换为动态获取 + 示例输出，不再有硬编码 vs 动态矛盾 ✅
- Transport 文件简化为直接使用 SDK 类 ✅
- pnpm workspace 注册不再需要（通配符覆盖） ✅
- npx 冷启动风险已在 Task 12 中提示 ✅
- run_query 安全说明已添加 ✅
- SSE → Streamable HTTP 已更新 ✅

## --- DESIGN APPROVED ---

approved_by: Architect
date: 2026-03-11
