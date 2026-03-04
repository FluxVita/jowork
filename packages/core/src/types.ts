// @jowork/core — global type definitions

// ─── Sensitivity ─────────────────────────────────────────────────────────────

/** Data sensitivity classification.
 * - public: Readable by all, including guests
 * - internal: Default. Readable by member+ (colleagues)
 * - confidential: Readable by admin+ (management)
 * - secret: Readable by owner only
 */
export type SensitivityLevel = 'public' | 'internal' | 'confidential' | 'secret';

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
  // Legacy connectors (FluxVita era — implementations may be custom per deployment)
  | 'feishu'
  | 'gitlab'
  | 'linear'
  | 'posthog'
  | 'figma'
  | 'email'
  | 'oss'
  // JCP connectors (built-in, auto-registered in connectors/index.ts)
  | 'github'
  | 'notion'
  | 'slack'
  | 'jira'
  | 'confluence';

export interface ConnectorConfig {
  id: ConnectorId;
  kind: ConnectorKind;
  name: string;
  settings: Record<string, unknown>;
  ownerId: UserId;
  createdAt: string;
}

// ─── Context docs (three-layer context system) ───────────────────────────────

export type ContextDocId = string;
export type ContextLayer = 'company' | 'team' | 'personal';
export type ContextDocType = 'manual' | 'rule' | 'workstyle' | 'learned' | 'onboarding_state';

export interface ContextDoc {
  id: ContextDocId;
  layer: ContextLayer;
  /** company_id | team_id | user_id — scopes the document to an entity */
  scopeId: string;
  title: string;
  content: string;
  docType: ContextDocType;
  /** When true, always loaded regardless of relevance (compliance rules etc.) */
  isForced: boolean;
  sensitivity: SensitivityLevel;
  createdBy: string;
  updatedAt: string;
}

// ─── Memory ──────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: MemoryId;
  userId: UserId;
  content: string;
  tags: string[];
  source: string;
  sensitivity: SensitivityLevel;
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
