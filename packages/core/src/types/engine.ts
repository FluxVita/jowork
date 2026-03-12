export type EngineId = 'claude-code' | 'openclaw' | 'codex' | 'jowork-cloud';
export type EngineType = 'local' | 'cloud';

export interface InstallStatus {
  installed: boolean;
  version?: string;
  error?: string;
}

export interface EngineEvent {
  type: 'system' | 'thinking' | 'text' | 'tool_use' | 'tool_result' | 'error' | 'done' | 'usage';
}

export interface ChatOpts {
  sessionId?: string;
  message: string;
  images?: string[];
  cwd?: string;
  /** Assembled context (workstyle, memories, docs) injected as system prompt prefix. */
  systemContext?: string;
}

export interface AgentEngine {
  id: EngineId;
  type: EngineType;
  checkInstalled(): Promise<InstallStatus>;
  install?(): Promise<void>;
  chat(opts: ChatOpts): AsyncGenerator<EngineEvent>;
  abort(): Promise<void>;
  process?: import('child_process').ChildProcess;
}
