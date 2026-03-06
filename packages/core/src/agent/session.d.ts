import type { Session, SessionMessage, EngineType } from './types.js';
export declare function createSession(userId: string, title?: string, engine?: EngineType): Session;
export declare function getSession(sessionId: string): Session | null;
export declare function listSessions(userId: string, limit?: number): Session[];
export declare function appendMessage(msg: {
    session_id: string;
    role: SessionMessage['role'];
    content: string;
    tool_name?: string;
    tool_call_id?: string;
    tool_status?: 'success' | 'error';
    duration_ms?: number;
    tokens?: number;
    model?: string;
    provider?: string;
    cost_usd?: number;
    metadata?: Record<string, unknown>;
}): number;
export declare function getMessages(sessionId: string, opts?: {
    limit?: number;
    offset?: number;
}): SessionMessage[];
export declare function updateSessionTitle(sessionId: string, title: string): void;
export declare function updateSessionSummary(sessionId: string, summary: string): void;
/** 搜索会话（按标题和消息内容） */
export declare function searchSessions(userId: string, query: string, limit?: number): Session[];
export declare function archiveSession(sessionId: string): void;
export declare function deleteSession(sessionId: string): void;
//# sourceMappingURL=session.d.ts.map