// @jowork/core — global type definitions

// ─── ID aliases ──────────────────────────────────────────────────────────────

export type UserId = string;
export type TeamId = string;
export type OrgId = string;
export type SessionId = string;
export type MemoryId = string;
export type ConnectorId = string;
export type TaskId = string;

// ─── RBAC ────────────────────────────────────────────────────────────────────

/** Canonical roles (RBAC v2). See JOWORK-PLAN.md §0.9 */
export type Role = 'owner' | 'admin' | 'member' | 'guest';

// ─── User ────────────────────────────────────────────────────────────────────

export interface User {
  id: UserId;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
}

// ─── Agent / Session ─────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  name: string;
  /** ISO string for when the agent was created */
  createdAt: string;
  systemPrompt: string;
  model: string;
  ownerId: UserId;
}

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool';

export interface Message {
  id: string;
  sessionId: SessionId;
  role: MessageRole;
  content: string;
  createdAt: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  toolCallId: string;
  content: string;
  isError?: boolean;
}

export interface AgentSession {
  id: SessionId;
  agentId: string;
  userId: UserId;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: Message[];
}

// ─── Connectors ──────────────────────────────────────────────────────────────

export type ConnectorKind =
  | 'feishu'
  | 'gitlab'
  | 'linear'
  | 'posthog'
  | 'figma'
  | 'email'
  | 'oss';

export interface ConnectorConfig {
  id: ConnectorId;
  kind: ConnectorKind;
  name: string;
  settings: Record<string, unknown>;
  ownerId: UserId;
  createdAt: string;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: MemoryId;
  userId: UserId;
  content: string;
  tags: string[];
  source: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Scheduler ───────────────────────────────────────────────────────────────

export interface SchedulerTask {
  id: TaskId;
  agentId: string;
  userId: UserId;
  name: string;
  cronExpr: string;
  action: string;
  params: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
}

// ─── Model ───────────────────────────────────────────────────────────────────

export interface ModelConfig {
  provider: 'anthropic' | 'openai' | 'moonshot' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
}

// ─── Error ───────────────────────────────────────────────────────────────────

export class JoworkError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 500,
  ) {
    super(message);
    this.name = 'JoworkError';
  }
}

export class NotFoundError extends JoworkError {
  constructor(resource: string) {
    super('NOT_FOUND', `${resource} not found`, 404);
    this.name = 'NotFoundError';
  }
}

export class ForbiddenError extends JoworkError {
  constructor(action = 'perform this action') {
    super('FORBIDDEN', `Not allowed to ${action}`, 403);
    this.name = 'ForbiddenError';
  }
}

export class UnauthorizedError extends JoworkError {
  constructor() {
    super('UNAUTHORIZED', 'Authentication required', 401);
    this.name = 'UnauthorizedError';
  }
}
