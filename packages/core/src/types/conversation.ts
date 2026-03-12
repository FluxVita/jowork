import type { EngineId } from './engine.js';

export interface Session {
  id: string;
  title: string;
  engineId: EngineId;
  createdAt: Date;
  updatedAt: Date;
  messageCount: number;
  mode: 'personal' | 'team';
}

export interface EngineSessionMapping {
  sessionId: string;
  engineId: EngineId;
  engineSessionId: string;
  createdAt: Date;
}

export interface Message {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  tokens?: number;
  cost?: number;
  createdAt: Date;
}
