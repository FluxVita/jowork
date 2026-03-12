# Phase 2: Connector + MCP

> **复杂度**: L | **依赖**: Phase 1 | **验收**: 连接 GitHub 后，引擎能用 `search_data` 查到真实数据

---

## 目标

实现 Connector 管理层（统一 OAuth、状态监控、命名空间），MCP 双向集成（Client + Server），连接 20 个数据源，并明确首发核心 connector 集合。

---

## 参考旧代码

| 旧文件 | 参考什么 |
|--------|---------|
| `packages/core/src/connectors/base.ts` | Connector 接口、AES-256-GCM 缓存、TTL 策略 |
| `packages/core/src/connectors/protocol.ts` | discover/fetch/health 三方法协议 |
| `packages/core/src/connectors/sync-state.ts` | 增量同步 cursor 持久化 |
| `packages/core/src/connectors/registry.ts` | Connector 工厂注册 |
| `packages/core/src/agent/mcp-bridge.ts` | MCP Client 进程管理、工具收集 |
| `packages/mcp-server/` | MCP Server 工具暴露、HTTP 代理模式 |
| `packages/core/src/datamap/db.ts` | objects 表（统一数据索引）、FTS 全文索引 |
| `packages/core/src/datamap/objects.ts` | DataObject CRUD、搜索 |

---

## 架构

```
Connector Manager (main process)
│
├── 社区 MCP Server（~15 个）
│   ├── 通过 npm/npx 启动 MCP Server 进程
│   ├── JoWork 作为 MCP Client 消费 tools
│   └── GitHub, Slack, Linear, Figma, Google 系列, Notion, Jira, Discord, PostHog, Outlook, Confluence
│
├── 自研 MCP Server（~5 个）
│   ├── 飞书（社区无现成 MCP）
│   ├── email-imap（通用 IMAP）
│   ├── local-files（本地文件系统）
│   ├── clipboard（剪贴板）
│   └── browser-history（浏览器历史）
│
├── 统一管理层
│   ├── OAuth 流程（Electron 弹窗 → 拦截回调）
│   ├── 凭据加密（safeStorage）
│   ├── 状态监控（健康检查 + 仪表盘）
│   ├── 命名空间（connector_id/tool_name）
│   └── 增量同步 + FTS 索引
│
└── JoWork MCP Server（暴露给外部工具）
    ├── search_data, fetch_content, list_sources
    ├── read_memory, write_memory
    ├── send_message, list_events, create_event
    └── 被 Claude Code / Cursor 调用
```

---

## 步骤

### 2.1 Connector Manager（合并管理层 + MCP 协议层）

**目录**: `apps/desktop/src/main/connectors/`

> **架构决策**: `ConnectorHub` 是唯一的管理入口。底层 MCP 通信封装在内部，不单独暴露 `McpHost`。
> 理由: 避免两个类职责重叠（都管理 MCP Server 进程和工具列表）。

```typescript
class ConnectorHub {
  // --- 管理层 (UI/设置 调用) ---
  async discoverAvailable(): Promise<ConnectorManifest[]>  // 扫描可用 MCP Server
  async install(connectorId: string): Promise<void>        // npm install MCP Server
  async healthCheck(): Promise<Map<string, HealthStatus>>   // 健康检查

  // --- MCP 协议层 (内部封装) ---
  async start(connectorId: string): Promise<void>           // 启动 MCP Server + 建立 Client 连接
  async stop(connectorId: string): Promise<void>
  async listAllTools(): Promise<NamespacedTool[]>            // 收集所有工具（connector_id/tool_name）
  async callTool(namespacedName: string, args: unknown): Promise<unknown>

  // --- 内部: MCP Client 管理 ---
  private clients: Map<string, Client>;   // @modelcontextprotocol/sdk Client 实例
  private async connectMcp(id: string, command: string, args: string[]): Promise<void>
}
```

### 2.2 OAuth 流程

**文件**: `apps/desktop/src/main/connectors/oauth-flow.ts`

```typescript
class OAuthFlow {
  // 打开 OAuth 授权窗口
  async authorize(connector: ConnectorManifest): Promise<OAuthTokens> {
    const authWindow = new BrowserWindow({ width: 600, height: 700 });
    authWindow.loadURL(connector.authUrl);

    // 拦截回调 URL
    return new Promise((resolve) => {
      authWindow.webContents.on('will-redirect', (event, url) => {
        if (url.startsWith(connector.callbackUrl)) {
          const code = new URL(url).searchParams.get('code');
          // 换 token
          resolve(exchangeToken(connector, code));
          authWindow.close();
        }
      });
    });
  }
}
```

### 2.3 凭据存储

**文件**: `apps/desktop/src/main/connectors/credential-store.ts`

```typescript
import { safeStorage } from 'electron';
import Store from 'electron-store';

class CredentialStore {
  private store = new Store({ name: 'credentials' });

  async save(connectorId: string, credentials: unknown): Promise<void> {
    const encrypted = safeStorage.encryptString(JSON.stringify(credentials));
    this.store.set(connectorId, encrypted.toString('base64'));
  }

  async load(connectorId: string): Promise<unknown | null> {
    const encrypted = this.store.get(connectorId) as string;
    if (!encrypted) return null;
    return JSON.parse(safeStorage.decryptString(Buffer.from(encrypted, 'base64')));
  }
}
```

**凭据模型（已确认）**:
- 默认只存本地：所有 connector 凭据先进入本地 `safeStorage`
- 云端代执行需单独授权：只有用户显式开启“允许云端代执行”后，才把该 connector 的云端副本存入云端 credential vault
- 支持“一键全开”：设置页提供批量开关，为所有支持云端执行的 connector 一次性授权
- 普通同步不会带上凭据：connector 凭据不进入 `/sync/push` 常规同步流

### 2.4 MCP 配置注入（从 Phase 1 移入）

**文件**: `apps/desktop/src/main/mcp/inject.ts`

> 从 Phase 1 移到 Phase 2，因为 MCP Server 在 Phase 2 才实现。

首次启动 + MCP Server 构建完成后，将 JoWork MCP Server 注册到用户的 MCP 配置中:
- Claude Code: `~/.claude.json` 的 `mcpServers` 字段
- OpenClaw: 对应的 `.mcp.json`

```json
{
  "mcpServers": {
    "jowork": {
      "command": "node",
      "args": ["/path/to/apps/desktop/dist/mcp-server.js"],
      "env": { "JOWORK_DB_PATH": "/path/to/jowork.db" }
    }
  }
}
```

### 2.5 JoWork MCP Server（独立 entry point）

**文件**: `apps/desktop/src/main/mcp/server.ts` + `apps/desktop/src/mcp-server-entry.ts`

> **关键架构**: JoWork MCP Server 必须能独立于 Electron 主进程运行。
> 因为 Claude Code 会自己 spawn 这个 server 进程（从 `.claude.json` 读取 command）。
>
> **Transport**: stdio（标准 MCP 方式，Claude Code 通过 stdin/stdout 通信）
>
> **Entry point**: `apps/desktop/src/mcp-server-entry.ts` — 独立的 Node.js 脚本
> - electron-vite build 时额外输出 `dist/mcp-server.js`
> - 直接 `node dist/mcp-server.js` 可运行，不依赖 Electron
> - 通过环境变量 `JOWORK_DB_PATH` 找到 SQLite 数据库
>
> **`apps/desktop/src/main/mcp/server.ts`** 是核心逻辑，被两处引用:
> 1. `mcp-server-entry.ts`（Claude Code spawn 的独立进程）
> 2. Electron main process（直接调用，不走 stdio）

暴露给 Claude Code / Cursor 的工具:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const server = new McpServer({ name: 'jowork', version: '1.0.0' });

// 数据查询
server.tool('search_data', { query: z.string(), source: z.string().optional() }, async ({ query, source }) => {
  // FTS 搜索 objects 表
});

server.tool('fetch_content', { uri: z.string() }, async ({ uri }) => {
  // 获取具体数据对象内容
});

server.tool('list_sources', {}, async () => {
  // 列出已连接数据源
});

// 记忆（Phase 3 实现）
server.tool('read_memory', { query: z.string() }, async ({ query }) => { ... });
server.tool('write_memory', { title: z.string(), content: z.string() }, async ({ title, content }) => { ... });

// 通信（Phase 5 实现）
server.tool('send_message', { channel: z.string(), message: z.string() }, async () => { ... });

// 通知
server.tool('notify', { title: z.string(), body: z.string() }, async () => { ... });
server.tool('ask_confirmation', { question: z.string() }, async () => { ... });
```

### 2.6 增量同步 + FTS 索引

**文件**: `packages/core/src/db/schema.ts`（新增表）

```typescript
// objects 表 — 统一数据索引
export const objects = sqliteTable('objects', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),           // 'github', 'slack', etc.
  sourceType: text('source_type').notNull(),   // 'repository', 'issue', 'message'
  uri: text('uri').notNull().unique(),
  title: text('title'),
  summary: text('summary'),
  tags: text('tags'),                          // JSON array
  lastSyncedAt: integer('last_synced_at'),
  createdAt: integer('created_at'),
});

// object_bodies 表 — 正文存储（大文本与正文分离，避免 objects 过重）
export const objectBodies = sqliteTable('object_bodies', {
  objectId: text('object_id').primaryKey().references(() => objects.id),
  content: text('content').notNull(),          // 原文 / markdown / diff / 文档正文
  contentType: text('content_type'),           // 'markdown' | 'html' | 'text' | 'json'
  fetchedAt: integer('fetched_at'),
});

// FTS 虚拟表（contentless 模式，程序手动维护）
// CREATE VIRTUAL TABLE objects_fts USING fts5(title, summary, tags, source, source_type, body, content='')
// ⚠️ 因为 body 来自 object_bodies 而非 objects，不能使用 FTS5 content table 语法糖
// 写入时机: objects + object_bodies INSERT/UPDATE 后，程序同步 INSERT INTO objects_fts
// 删除时机: objects DELETE 前，程序先 DELETE FROM objects_fts
// search_data 查 FTS 返回 object_id → fetch_content 读 object_bodies.content

// sync_cursors 表
export const syncCursors = sqliteTable('sync_cursors', {
  connectorId: text('connector_id').primaryKey(),
  cursor: text('cursor'),
  lastSyncedAt: integer('last_synced_at'),
});
```

### 2.7 Connector UI

**目录**: `apps/desktop/src/renderer/features/connectors/`

```
connectors/
├── ConnectorsPage.tsx        # Connector 管理主页
├── ConnectorCard.tsx         # 单个 Connector 卡片（状态、操作）
├── OAuthDialog.tsx           # OAuth 授权弹窗
├── ConnectorDetail.tsx       # 详情：数据预览、同步日志、设置
├── HealthDashboard.tsx       # 健康状态仪表盘
└── hooks/
    └── useConnectors.ts      # Connector 状态管理
```

### 2.8 右侧上下文面板

**文件**: `apps/desktop/src/renderer/components/ContextPanel.tsx`

根据当前对话内容动态展示:
- 提到 PR → 展示 PR 详情（diff、状态、reviewer）
- 提到文档 → 文档预览
- 提到 issue → issue 详情
- 搜索结果 → 结果列表

---

## 20 个 Connector 清单

### 首发范围分层（已确认）

**核心首发集合（5 个 connector / 6 项关键能力）**:
- GitHub
- GitLab
- Figma
- Feishu 群消息
- Feishu 文档
- 本地项目文件夹

实现说明:
- Feishu 作为一个首发 connector 包交付，但必须覆盖“群消息 + 文档”两项关键能力
- 首发文档、官网和 onboarding 只按核心首发集合承诺，不把其它待确认 connector 写成 GA

**分层规则**:
- `GA`: 核心首发集合，进入 onboarding 主推荐
- `Beta`: 已验证但不进入 onboarding 主流程
- `Planned`: 仅 roadmap 展示，不写成“当前已支持”

### 社区 MCP Server（~15 个，npm 安装）

| # | 服务 | npm 包 | 状态 |
|---|------|--------|------|
| 1 | GitHub | `@modelcontextprotocol/server-github` | 已有 |
| 2 | GitLab | `@modelcontextprotocol/server-gitlab` | 已有 |
| 3 | Slack | `@modelcontextprotocol/server-slack` | Beta |
| 4 | Linear | `mcp-linear` 或类似 | 待确认 |
| 5 | Figma | `@anthropic-ai/figma-mcp` | 已有 |
| 6 | Google Drive | `@anthropic-ai/google-drive-mcp` | Planned |
| 7 | Google Calendar | 社区包 | Planned |
| 8 | Google Docs | 社区包 | Planned |
| 9 | Gmail | 社区包 | Planned |
| 10 | Notion | `@notionhq/mcp-server` 或类似 | Planned |
| 11 | Jira | 社区包 | Planned |
| 12 | Confluence | 社区包 | Planned |
| 13 | Discord | 社区包 | Planned |
| 14 | PostHog | 社区包 | Planned |
| 15 | Outlook | 社区包 | Planned |

### 自研 MCP Server（~5 个）

| # | 服务 | 目录 | 原因 |
|---|------|------|------|
| 16 | 飞书（群消息 + 文档） | `packages/connectors/feishu/` | 核心首发；社区无现成 MCP |
| 17 | Email (IMAP) | `packages/connectors/email-imap/` | 通用 IMAP 协议 |
| 18 | 本地文件 | `packages/connectors/local-files/` | 本地文件系统操作 |
| 19 | 剪贴板 | `packages/connectors/clipboard/` | 剪贴板读写 |
| 20 | 浏览器历史 | `packages/connectors/browser-history/` | 浏览器历史记录 |

> **`packages/connectors/` 结构**: 每个子目录是独立的 npm 包（有自己的 `package.json`），
> 因为它们需要作为独立 MCP Server 进程被 spawn。
> `pnpm-workspace.yaml` 需要添加 `'packages/connectors/*'`。
>
> 每个自研 connector 包的结构:
> ```
> packages/connectors/feishu/
> ├── package.json       # name: "@jowork/connector-feishu"
> ├── tsconfig.json
> └── src/
>     ├── index.ts       # MCP Server entry (stdio transport)
>     └── tools/         # 工具实现
> ```

---

## 验收标准

- [ ] 连接 GitHub（OAuth 授权流程完整）
- [ ] GitHub 数据同步到 `objects` + `object_bodies`（repos, issues, PRs）
- [ ] FTS 搜索可查到 GitHub 数据，`fetch_content` 可返回正文
- [ ] 引擎可调用 `search_data` 工具查到真实数据
- [ ] Connector 管理页面显示连接状态
- [ ] 健康检查正常运行
- [ ] JoWork MCP Server 可被 Claude Code 调用
- [ ] 核心首发集合全部可用：GitHub、GitLab、Figma、Feishu（群消息 + 文档）、本地项目文件夹

---

## 产出文件

```
apps/desktop/src/main/connectors/
├── hub.ts
├── oauth-flow.ts
└── credential-store.ts

apps/desktop/src/main/mcp/
├── server.ts              # MCP Server 核心逻辑
├── inject.ts              # MCP 配置注入（写入 .claude.json）
└── registry.ts

apps/desktop/src/
└── mcp-server-entry.ts    # 独立 entry point（Claude Code spawn 用）

packages/connectors/
├── feishu/         # 自研
├── email-imap/     # 自研
├── local-files/    # 自研
├── clipboard/      # 自研
└── browser-history/ # 自研

apps/desktop/src/renderer/features/connectors/
├── ConnectorsPage.tsx
├── ConnectorCard.tsx
├── OAuthDialog.tsx
├── ConnectorDetail.tsx
├── HealthDashboard.tsx
└── hooks/
    └── useConnectors.ts
```
