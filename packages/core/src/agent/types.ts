import type { Role } from '../types.js';

// ─── Engine Types ───

export type EngineType = 'builtin' | 'claude_agent';

export interface ImageAttachment {
  /** base64 编码的图片数据（不含 data:xxx;base64, 前缀） */
  data: string;
  /** MIME 类型，如 image/jpeg / image/png / image/gif / image/webp */
  media_type: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export interface AgentEngineOpts {
  userId: string;
  role: Role;
  sessionId: string;
  message: string;
  /** 随消息一起发送的图片附件 */
  images?: ImageAttachment[];
  signal?: AbortSignal;
  /** 额外的工具定义（来自 MCP/Skills） */
  extraTools?: AnthropicToolDef[];
  /** 额外的 system prompt 片段 */
  extraPrompts?: string[];
  /** 外部工具执行器（MCP/Skills 工具） */
  externalToolExecutor?: (name: string, input: Record<string, unknown>) => Promise<string>;
  /** 飞书群聊标记 */
  isGroupChat?: boolean;
  /** Channel 抽象 */
  channel?: { id: string; type: string };
}

export interface AgentEngine {
  readonly type: EngineType;
  run(opts: AgentEngineOpts): AsyncGenerator<AgentEvent>;
}

// ─── Session ───

export interface Session {
  session_id: string;
  user_id: string;
  title: string;
  message_count: number;
  total_tokens: number;
  total_cost: number;
  summary: string | null;
  engine: EngineType;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface SessionMessage {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result';
  content: string;
  tool_name: string | null;
  tool_call_id: string | null;
  tool_status: string | null;
  duration_ms: number | null;
  tokens: number;
  model: string | null;
  provider: string | null;
  cost_usd: number;
  metadata_json: string | null;
  created_at: string;
}

// ─── Tool ───

export interface ToolContext {
  user_id: string;
  role: Role;
  session_id: string;
}

export type ToolResultType = 'text' | 'list' | 'table' | 'markdown' | 'file';

export interface StructuredListItem {
  title: string;
  meta?: string;
  description?: string;
  uri?: string;
}

export interface StructuredResult {
  type: ToolResultType;
  /** 'list' 类型：条目列表 */
  items?: StructuredListItem[];
  /** 'table' 类型：行数据 */
  rows?: Record<string, string>[];
  /** 'table' 类型：列名顺序 */
  columns?: string[];
  /** 'markdown' 类型：内容文本 */
  content?: string;
  /** 'file' 类型：文件路径（服务端绝对路径）和文件名 */
  file_path?: string;
  file_name?: string;
  /** 可选总数 */
  total?: number;
}

export interface Tool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string>;
  /** 可选：返回结构化结果（text 给 LLM，structured 给前端渲染） */
  executeStructured?(input: Record<string, unknown>, ctx: ToolContext): Promise<{ text: string; structured: StructuredResult }>;
}

// ─── Agent SSE Events ───

export type AgentEvent =
  | { event: 'session_created'; data: { session_id: string } }
  | { event: 'thinking'; data: { round: number } }
  | { event: 'text_delta'; data: { delta: string } }
  | { event: 'activity'; data: { message: string } }
  | { event: 'tool_call'; data: { id?: string; name: string; input: Record<string, unknown>; status?: string } }
  | { event: 'tool_result'; data: { id?: string; name: string; result_preview: string; status?: 'success' | 'error'; duration_ms?: number; result_type?: ToolResultType; structured?: StructuredResult } }
  | { event: 'tool_update'; data: { id: string; status: string; message?: string } }
  | { event: 'text_done'; data: { content: string; message_id?: number } }
  | { event: 'file_attachment'; data: { filename: string; download_token: string; size_bytes: number; mime?: string } }
  | { event: 'usage'; data: { tokens_in: number; tokens_out: number; model: string; cost_usd: number } }
  | { event: 'engine_info'; data: { engine: EngineType; model?: string } }
  | { event: 'stopped'; data: Record<string, never> }
  | { event: 'error'; data: { message: string } }
  | { event: 'learn_suggestion'; data: { title: string; content: string; user_id: string } }
  | { event: 'credits_exhausted'; data: { used: number; total: number; upgrade_to: string | null } };

// ─── Anthropic API Types (tool_use) ───

export interface AnthropicToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface AnthropicContentBlock {
  type: 'text' | 'tool_use';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface AnthropicToolResult {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
}

export interface ToolCallResult {
  stop_reason: 'end_turn' | 'tool_use';
  content: string;
  tool_calls: { id: string; name: string; input: Record<string, unknown> }[];
  tokens_in: number;
  tokens_out: number;
}
