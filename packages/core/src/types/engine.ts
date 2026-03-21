/** Engine identifier — extensible string with well-known constants. */
export type EngineId = string;

// Well-known engine IDs
export const ENGINE_CLAUDE_CODE = 'claude-code';
export const ENGINE_OPENCLAW = 'openclaw';
export const ENGINE_NEMOCLAW = 'nemoclaw';
export const ENGINE_CLOUD = 'jowork-cloud';
export type EngineType = 'local' | 'cloud';
export type TokenSource = 'user-byo' | 'jowork';

export interface EngineResolution {
  engineId: EngineId;
  tokenSource: TokenSource;
  /** Human-readable explanation shown in Settings UI. */
  reason: string;
  quotaInfo?: {
    sessionAllowed: boolean;
    messageAllowed: boolean;
    sessionsUsedToday: number;
    messagesUsedThisSession: number;
  };
}

export interface InstallStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface EngineEvent {
  type: 'system' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'error' | 'done' | 'usage' | 'session_bound';
}

export interface ChatOpts {
  sessionId?: string;
  message: string;
  images?: string[];
  cwd?: string;
  /** Assembled context (workstyle, memories, docs) injected as system prompt prefix. */
  systemContext?: string;
  /** Injected by EngineManager when tokenSource === 'jowork' and using a local engine (Phase 4+). */
  joworkApiKey?: string;
}

export interface AgentEngine {
  id: EngineId;
  type: EngineType;
  /** Pass joworkApiKey when user has a JoWork subscription but no BYOK configured. */
  checkInstalled(joworkApiKey?: string): Promise<InstallStatus>;
  install?(): Promise<void>;
  chat(opts: ChatOpts): AsyncGenerator<EngineEvent>;
  abort(): Promise<void>;
  process?: import('child_process').ChildProcess;
}
