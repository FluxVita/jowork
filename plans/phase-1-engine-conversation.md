# Phase 1: 引擎 + 核心对话

> **复杂度**: XL（关键路径） | **依赖**: Phase 0 | **验收**: 用户输入消息 → Claude Code 处理 → 流式回复渲染

---

## 目标

实现引擎管理器、Claude Code 本地适配器、对话 UI、流式渲染、对话历史持久化。这是所有后续功能的基础。

---

## 参考旧代码

| 旧文件 | 参考什么 |
|--------|---------|
| `apps/jowork/src-tauri/src/lib.rs` | Claude Code CLI spawn 方式、`--output-format stream-json` 解析、`--resume` 用法 |
| `packages/core/src/agent/controller.ts` | Agent loop 事件流设计、多轮 tool calling |
| `packages/core/src/agent/session.ts` | Session 创建/恢复、消息持久化、token/cost 追踪 |
| `packages/core/src/agent/types.ts` | AgentEvent union type 定义（11 种事件） |
| `packages/core/src/models/router.ts` | 多 provider 路由、降级逻辑、成本追踪 |

---

## 步骤

### 1.1 Engine Manager（主进程）

**文件**: `apps/desktop/src/main/engine/manager.ts`

核心职责:
- 管理引擎生命周期（检测 → 安装 → 启动 → 对话 → 终止）
- 维护当前活跃引擎实例
- 引擎切换时迁移上下文

```typescript
class EngineManager {
  private engines: Map<EngineId, AgentEngine>;
  private activeEngineId: EngineId;

  async detectEngines(): Promise<Map<EngineId, InstallStatus>>
  async switchEngine(id: EngineId): Promise<void>
  async *chat(opts: ChatOpts): AsyncGenerator<EngineEvent>  // 注意: async *generator
  async abort(): Promise<void>

  // 引擎崩溃恢复: subprocess 意外退出时自动重启 + 通知用户
  private handleEngineCrash(engineId: EngineId, error: Error): void
}
```

**检测逻辑**:
- Claude Code: `which claude` 或 `claude --version`
- OpenClaw: `which openclaw`（预留）
- Cloud Engine: 检查 JoWork Cloud 登录状态 + 积分余额

**安装逻辑**（后台，不阻塞 UI）:
- Claude Code: `npm install -g @anthropic-ai/claude-code` 或 `brew install claude`
- 安装过程通过 IPC 报告进度

### 1.2 Claude Code 本地适配器

**文件**: `apps/desktop/src/main/engine/claude-code.ts`

**SDK 模式**（首选）:
```typescript
import { query } from '@anthropic-ai/claude-agent-sdk';

class ClaudeCodeEngine implements AgentEngine {
  id = 'claude-code' as const;
  type = 'local' as const;

  async *chat(opts: ChatOpts): AsyncGenerator<EngineEvent> {
    // opts.sessionId 永远是 JoWork sessionId；adapter 内部解析引擎 resume id
    const engineSessionId = await historyManager.getEngineSessionId(opts.sessionId, 'claude-code');
    const stream = query({
      prompt: opts.message,
      options: {
        resume: engineSessionId,
        cwd: opts.cwd,
        allowedTools: ['Read', 'Edit', 'Bash', 'Glob', 'Grep', 'Write'],
      },
    });

    for await (const msg of stream) {
      yield this.mapToEngineEvent(msg);
    }
  }
}
```

**CLI 备选模式**（SDK 不可用时）:
```typescript
// spawn('claude', ['-p', '--output-format', 'stream-json', message])
// 逐行解析 stdout JSON-lines
```

**Session 映射**:
- `JoWork session.id` 是产品内唯一主键
- `engine_session_id` 是 Claude Code / OpenClaw 的外部映射 ID
- 存储映射关系到 SQLite
- `chat()` 对上层始终只接收 JoWork sessionId；adapter 内部解析对应的 `engine_session_id`
- `--resume` 时传入 Claude Code 的 `engine_session_id`
- **`--resume` 跨 App 重启**: Claude Code session 存在 `~/.claude/projects/`，App 重启后仍有效
- **健壮性处理**: resume 前检测引擎侧 session 是否仍存在，若已失效则自动创建新 session 并从 JoWork 历史重建上下文

### 1.3 Cloud Engine 适配器（接口预留）

**文件**: `apps/desktop/src/main/engine/cloud.ts`

> **⚠️ Cloud Engine 在 Phase 6 完成云服务后才可用。Phase 1-5 仅支持本地引擎。**
> Phase 1 只实现适配器接口 + 占位逻辑（返回 "Cloud Engine 尚未可用" 提示）。

```typescript
class CloudEngine implements AgentEngine {
  id = 'jowork-cloud' as const;
  type = 'cloud' as const;

  async *chat(opts: ChatOpts): AsyncGenerator<EngineEvent> {
    // Phase 1-5: 返回提示信息
    // Phase 6+: POST https://api.jowork.work/engine/chat (SSE stream)
    const response = await fetch(cloudUrl + '/engine/chat', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ sessionId, message, tools }),
    });

    const reader = response.body.getReader();
    // 解析 SSE events → yield EngineEvent
  }
}
```

### 1.4 对话历史管理

**文件**: `apps/desktop/src/main/engine/history.ts`

**引擎 session 映射表**（`packages/core/src/db/schema.ts` 新增）:
```typescript
export const engineSessionMappings = sqliteTable('engine_session_mappings', {
  sessionId: text('session_id').notNull().references(() => sessions.id),
  engineId: text('engine_id').notNull(),          // 'claude-code' | 'openclaw' | ...
  engineSessionId: text('engine_session_id').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => ({ pk: primaryKey(t.sessionId, t.engineId) }));
```

**双写策略**:
1. 每条消息实时写入 SQLite（JoWork 侧）
2. 本地引擎同时用 `--resume` 保持引擎侧上下文

```typescript
class HistoryManager {
  // 创建新 session
  createSession(engineId: EngineId, title?: string): Session
  // 获取/更新引擎侧 session 映射
  getEngineSessionId(sessionId: string, engineId: EngineId): string | null
  bindEngineSession(sessionId: string, engineId: EngineId, engineSessionId: string): void
  // 追加消息
  appendMessage(sessionId: string, msg: Message): void
  // 列出 sessions（分页）
  listSessions(opts: { mode, limit, offset }): Session[]
  // 获取 session 消息
  getMessages(sessionId: string): Message[]
  // 引擎切换时：从 JoWork 历史重建上下文注入新引擎
  rebuildContextForEngine(sessionId: string, targetEngine: EngineId): string
}
```

### 1.5 IPC 通道定义

**文件**: `apps/desktop/src/main/ipc.ts` + `src/preload/index.ts`

```typescript
// 引擎相关
'engine:detect'          → Map<EngineId, InstallStatus>
'engine:install'         → void (启动后台安装)
'engine:switch'          → void
'engine:get-active'      → EngineId

// 对话相关
'chat:send'              → void (触发流式响应)
'chat:abort'             → void
'chat:on-event'          → callback(EngineEvent)  // main → renderer 推送

// 会话管理
'session:list'           → Session[]
'session:get'            → Session & { messages: Message[] }
'session:create'         → Session
'session:delete'         → void
'session:rename'         → void
```

### 1.6 对话 UI

**文件**: `apps/desktop/src/renderer/features/conversation/`

```
conversation/
├── ConversationPage.tsx      # 页面容器
├── MessageList.tsx           # 消息列表（虚拟滚动）
├── MessageBubble.tsx         # 单条消息渲染
├── ToolCallCard.tsx          # 工具调用可视化（折叠卡片）
├── ToolResultCard.tsx        # 工具结果渲染
├── InputBox.tsx              # 输入框 + 发送按钮
├── StreamingText.tsx         # 流式文本渲染 + Markdown
├── SessionList.tsx           # 会话列表（侧边栏内）
├── EngineIndicator.tsx       # 当前引擎状态指示器
└── hooks/
    ├── useChat.ts            # 对话状态管理 hook
    ├── useSession.ts         # 会话 CRUD hook
    └── useEngine.ts          # 引擎状态 hook
```

**消息渲染**: 根据 `role` 区分样式:
- `user` — 右对齐，用户头像
- `assistant` — 左对齐，JoWork 图标
- `tool_call` — 灰色卡片，显示工具名 + 参数（可展开）
- `tool_result` — 工具返回值（代码块或预览）
- `system` — 居中灰色文字

**流式渲染**: 收到 `text` 事件时实时追加。
- 使用 `markdown-it`（增量友好）+ 自定义 React wrapper
- **不用 `react-markdown`**: 它每次更新重新解析整个 markdown，流式场景性能差
- 策略: 已完成的 block 缓存渲染结果，只重新渲染正在流入的最后一个 block

**输入框**:
- `Cmd+Enter` 发送，`Enter` 换行
- 支持图片拖拽/粘贴（转为 base64 传给引擎）
- 发送时显示引擎状态（"Claude Code 思考中..."）

### 1.7 Zustand Store

**文件**: `apps/desktop/src/renderer/stores/`

```typescript
// stores/conversation.ts
interface ConversationStore {
  sessions: Session[];
  activeSessionId: string | null;
  messages: Message[];
  isStreaming: boolean;
  streamingText: string;

  sendMessage(content: string): void;
  abort(): void;
  selectSession(id: string): void;
  createSession(): void;
  deleteSession(id: string): void;
}

// stores/engine.ts
interface EngineStore {
  engines: Map<EngineId, InstallStatus>;
  activeEngineId: EngineId;
  isInstalling: boolean;
  installProgress: number;

  detect(): void;
  switchEngine(id: EngineId): void;
}
```

### 1.8 引擎崩溃恢复

**文件**: `apps/desktop/src/main/engine/recovery.ts`

Claude Code subprocess 可能因各种原因意外退出（OOM、段错误、网络超时）。

```typescript
class EngineRecovery {
  // 监听 subprocess exit 事件
  watchProcess(engine: AgentEngine): void {
    engine.process.on('exit', (code, signal) => {
      if (code !== 0) {
        // 通知 renderer: "AI 引擎异常退出，正在重启..."
        mainWindow.webContents.send('engine:crashed', { engineId, code, signal });
        // 自动重启（最多 3 次，间隔递增）
        this.attemptRestart(engine, retryCount);
      }
    });
  }
}
```

> **注意**: MCP 配置注入（将 JoWork MCP Server 注册到 `.claude.json`）移至 **Phase 2**。
> 因为 Phase 1 时 MCP Server 尚未实现，注入一个不存在的 server 会导致 Claude Code 启动报错。

---

## 验收标准

- [ ] 启动 App 后自动检测已安装的引擎
- [ ] 侧边栏显示会话列表，可创建新会话
- [ ] 输入消息 → Claude Code 处理 → 流式文本出现在对话区
- [ ] 工具调用显示为可折叠卡片（工具名 + 参数 + 结果）
- [ ] Markdown 正确渲染（代码块、链接、列表等）
- [ ] 会话历史持久化到 SQLite，重启 App 后恢复
- [ ] 切换引擎后对话可继续（上下文从 JoWork 历史重建）
- [ ] Abort 按钮可中断流式响应
- [ ] 未安装引擎时显示引导安装 UI（后台安装，不阻塞）

---

## 产出文件

```
apps/desktop/src/main/engine/
├── manager.ts
├── claude-code.ts
├── cloud.ts           # 接口预留，Phase 6+ 才可用
├── history.ts
├── recovery.ts        # 崩溃恢复
└── types.ts           # re-export @jowork/core/types/engine + desktop-specific 补充类型（InstallProgress 等）

apps/desktop/src/renderer/features/conversation/
├── ConversationPage.tsx
├── MessageList.tsx
├── MessageBubble.tsx
├── ToolCallCard.tsx
├── ToolResultCard.tsx
├── InputBox.tsx
├── StreamingText.tsx
├── SessionList.tsx
├── EngineIndicator.tsx
└── hooks/ (useChat.ts, useSession.ts, useEngine.ts)

apps/desktop/src/renderer/stores/
├── conversation.ts
└── engine.ts
```
