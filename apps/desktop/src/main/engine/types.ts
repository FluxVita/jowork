// Re-export core engine types + desktop-specific additions
export type {
  EngineId,
  EngineType,
  InstallStatus,
  EngineEvent,
  ChatOpts,
  AgentEngine,
} from '@jowork/core';

export interface InstallProgress {
  engineId: string;
  stage: 'downloading' | 'installing' | 'configuring' | 'done' | 'error';
  progress: number; // 0-100
  message?: string;
}

export interface EngineStatus {
  engineId: string;
  installed: boolean;
  version?: string;
  active: boolean;
}
