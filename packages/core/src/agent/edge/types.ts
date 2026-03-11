/**
 * Edge Agent 类型定义
 *
 * 定义 Edge sidecar 与 Gateway 之间的通信协议，
 * 以及 EdgeBackend 抽象接口（LocalBackend / ServerBackend 共用）。
 */

import type { AgentEvent, AnthropicToolDef, ToolContext } from '../types.js';

// ─── EdgeBackend 抽象接口 ───

/** 模型调用事件（streaming） */
export type ModelEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'end_turn'; content: string; tokens_in: number; tokens_out: number; cost_usd: number; model: string }
  | { type: 'error'; message: string };

/** Edge session 消息 */
export interface EdgeMessage {
  /** 客户端生成的幂等 ID */
  client_msg_id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  tool_name?: string;
  tool_call_id?: string;
  tool_status?: 'success' | 'error';
  /** 标记 tool result 来源：edge_local = 客户端本地执行 */
  source?: 'edge_local' | 'edge_remote';
  tokens?: number;
  model?: string;
  provider?: string;
  cost_usd?: number;
  created_at?: string;
}

/**
 * EdgeBackend 接口 — Agent loop 的依赖注入点。
 *
 * - LocalBackend: JSON 文件存储 + BYOK 直连（个人本地版）
 * - ServerBackend: HTTP → Gateway（个人服务器版 / 团队版）
 */
export interface EdgeBackend {
  /** 调用模型（streaming） */
  callModel(
    system: string,
    messages: Array<{ role: string; content: unknown }>,
    tools: AnthropicToolDef[],
  ): AsyncGenerator<ModelEvent>;

  /** 获取远程工具定义列表（LocalBackend 返回 []） */
  listRemoteTools(): Promise<AnthropicToolDef[]>;

  /** 执行远程工具（LocalBackend 抛异常 "not available"） */
  executeRemoteTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string>;

  /** 保存消息到持久化存储 */
  saveMessage(msg: EdgeMessage): Promise<void>;

  /** 加载 session 历史消息 */
  loadHistory(sessionId: string): Promise<EdgeMessage[]>;

  /** 创建或恢复 session，返回 session_id */
  ensureSession(sessionId?: string, title?: string): Promise<string>;
}

// ─── Edge API 请求/响应类型 ───

/** POST /api/edge/session */
export interface EdgeSessionRequest {
  session_id?: string;
  title?: string;
}

export interface EdgeSessionResponse {
  session_id: string;
  created: boolean;
}

/** GET /api/edge/tools */
export interface EdgeToolsResponse {
  tools: AnthropicToolDef[];
}

/** POST /api/edge/tool */
export interface EdgeToolRequest {
  name: string;
  input: Record<string, unknown>;
  session_id: string;
}

export interface EdgeToolResponse {
  result: string;
  status: 'success' | 'error';
  duration_ms: number;
}

/** POST /api/edge/model — streaming SSE response */
export interface EdgeModelRequest {
  system: string;
  messages: Array<{ role: string; content: unknown }>;
  tools: AnthropicToolDef[];
  session_id: string;
  max_tokens?: number;
}

/** POST /api/edge/messages */
export interface EdgeMessagesRequest {
  messages: EdgeMessage[];
}

export interface EdgeMessagesResponse {
  accepted: number;
  duplicates: number;
}

// ─── Edge Sidecar stdin/stdout 协议 ───

/** Sidecar 启动时从 stdin 读取的配置 */
export interface SidecarConfig {
  /** "local" = 个人本地版，"server" = 有 Gateway */
  backend: 'local' | 'server';
  /** server mode 必须 */
  gateway_url?: string;
  /** server mode 必须 */
  jwt?: string;
  /** local mode 必须 */
  api_key?: string;
  /** local mode: 模型提供商（openrouter / anthropic / openai 等） */
  api_provider?: string;
  /** 用户消息 */
  message: string;
  /** session ID（不传则新建） */
  session_id?: string;
  /** 工作目录（local tools 的 cwd） */
  cwd?: string;
}

/** Sidecar 通过 stdout 输出的 JSON lines 事件 */
export type SidecarEvent = AgentEvent;
