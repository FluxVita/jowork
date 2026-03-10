import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
import type { Session, SessionMessage, EngineType, SessionType } from './types.js';

// ─── Row → Object ───

function rowToSession(row: Record<string, unknown>): Session {
  return {
    session_id: row['session_id'] as string,
    user_id: row['user_id'] as string,
    title: row['title'] as string,
    message_count: row['message_count'] as number,
    total_tokens: row['total_tokens'] as number,
    total_cost: row['total_cost'] as number,
    summary: row['summary'] as string | null,
    engine: (row['engine'] as EngineType) ?? 'builtin',
    parent_session_id: (row['parent_session_id'] as string | null) ?? null,
    session_type: (row['session_type'] as SessionType) ?? 'main',
    agent_config_json: (row['agent_config_json'] as string | null) ?? null,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
    archived_at: row['archived_at'] as string | null,
  };
}

function rowToMessage(row: Record<string, unknown>): SessionMessage {
  return {
    id: row['id'] as number,
    session_id: row['session_id'] as string,
    role: row['role'] as SessionMessage['role'],
    content: row['content'] as string,
    tool_name: row['tool_name'] as string | null,
    tool_call_id: row['tool_call_id'] as string | null,
    tool_status: row['tool_status'] as string | null,
    duration_ms: row['duration_ms'] as number | null,
    tokens: row['tokens'] as number,
    model: row['model'] as string | null,
    provider: row['provider'] as string | null,
    cost_usd: row['cost_usd'] as number,
    metadata_json: row['metadata_json'] as string | null,
    created_at: row['created_at'] as string,
  };
}

// ─── CRUD ───

export function createSession(
  userId: string,
  title?: string,
  engine?: EngineType,
  opts?: { sessionType?: SessionType; parentSessionId?: string; agentConfig?: Record<string, unknown> },
): Session {
  const db = getDb();
  const sessionId = genId('ses');
  const now = new Date().toISOString();
  const eng = engine ?? 'builtin';
  const sessionType = opts?.sessionType ?? 'main';
  const parentSessionId = opts?.parentSessionId ?? null;
  const agentConfigJson = opts?.agentConfig ? JSON.stringify(opts.agentConfig) : null;

  db.prepare(`
    INSERT INTO sessions (session_id, user_id, title, engine, parent_session_id, session_type, agent_config_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, title ?? '新对话', eng, parentSessionId, sessionType, agentConfigJson, now, now);

  return {
    session_id: sessionId,
    user_id: userId,
    title: title ?? '新对话',
    message_count: 0,
    total_tokens: 0,
    total_cost: 0,
    summary: null,
    engine: eng,
    parent_session_id: parentSessionId,
    session_type: sessionType,
    agent_config_json: agentConfigJson,
    created_at: now,
    updated_at: now,
    archived_at: null,
  };
}

export function getSession(sessionId: string): Session | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Record<string, unknown> | undefined;
  return row ? rowToSession(row) : null;
}

export function listSessions(userId: string, limit = 50): Session[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM sessions WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?'
  ).all(userId, limit) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function appendMessage(msg: {
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
}): number {
  const db = getDb();
  const now = new Date().toISOString();

  const result = db.prepare(`
    INSERT INTO session_messages (session_id, role, content, tool_name, tool_call_id, tool_status, duration_ms, tokens, model, provider, cost_usd, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    msg.session_id, msg.role, msg.content,
    msg.tool_name ?? null, msg.tool_call_id ?? null,
    msg.tool_status ?? null, msg.duration_ms ?? null,
    msg.tokens ?? 0, msg.model ?? null, msg.provider ?? null,
    msg.cost_usd ?? 0,
    msg.metadata ? JSON.stringify(msg.metadata) : null,
    now,
  );

  // 更新 session 统计
  db.prepare(`
    UPDATE sessions SET
      message_count = message_count + 1,
      total_tokens = total_tokens + ?,
      total_cost = total_cost + ?,
      updated_at = ?
    WHERE session_id = ?
  `).run(msg.tokens ?? 0, msg.cost_usd ?? 0, now, msg.session_id);

  return Number(result.lastInsertRowid);
}

export function getMessages(sessionId: string, opts?: { limit?: number; offset?: number }): SessionMessage[] {
  const db = getDb();
  const limit = opts?.limit ?? 200;
  const offset = opts?.offset ?? 0;
  const rows = db.prepare(
    'SELECT * FROM session_messages WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?'
  ).all(sessionId, limit, offset) as Record<string, unknown>[];
  return rows.map(rowToMessage);
}

export function updateSessionTitle(sessionId: string, title: string) {
  const db = getDb();
  db.prepare('UPDATE sessions SET title = ?, updated_at = datetime(\'now\') WHERE session_id = ?')
    .run(title, sessionId);
}

export function updateSessionSummary(sessionId: string, summary: string) {
  const db = getDb();
  db.prepare('UPDATE sessions SET summary = ?, updated_at = datetime(\'now\') WHERE session_id = ?')
    .run(summary, sessionId);
}

/** 搜索会话（按标题和消息内容） */
export function searchSessions(userId: string, query: string, limit = 20): Session[] {
  const db = getDb();
  const like = `%${query}%`;
  // 先按标题匹配，再按消息内容匹配
  const rows = db.prepare(`
    SELECT DISTINCT s.* FROM sessions s
    LEFT JOIN session_messages m ON s.session_id = m.session_id
    WHERE s.user_id = ? AND s.archived_at IS NULL
      AND (s.title LIKE ? OR m.content LIKE ?)
    ORDER BY s.updated_at DESC LIMIT ?
  `).all(userId, like, like, limit) as Record<string, unknown>[];
  return rows.map(rowToSession);
}

export function archiveSession(sessionId: string) {
  const db = getDb();
  db.prepare('UPDATE sessions SET archived_at = datetime(\'now\') WHERE session_id = ?')
    .run(sessionId);
}

export function deleteSession(sessionId: string) {
  const db = getDb();
  const del = db.transaction(() => {
    db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(sessionId);
    db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
  });
  del();
}
