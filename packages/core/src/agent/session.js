import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
// ─── Row → Object ───
function rowToSession(row) {
    return {
        session_id: row['session_id'],
        user_id: row['user_id'],
        title: row['title'],
        message_count: row['message_count'],
        total_tokens: row['total_tokens'],
        total_cost: row['total_cost'],
        summary: row['summary'],
        engine: row['engine'] ?? 'builtin',
        created_at: row['created_at'],
        updated_at: row['updated_at'],
        archived_at: row['archived_at'],
    };
}
function rowToMessage(row) {
    return {
        id: row['id'],
        session_id: row['session_id'],
        role: row['role'],
        content: row['content'],
        tool_name: row['tool_name'],
        tool_call_id: row['tool_call_id'],
        tool_status: row['tool_status'],
        duration_ms: row['duration_ms'],
        tokens: row['tokens'],
        model: row['model'],
        provider: row['provider'],
        cost_usd: row['cost_usd'],
        metadata_json: row['metadata_json'],
        created_at: row['created_at'],
    };
}
// ─── CRUD ───
export function createSession(userId, title, engine) {
    const db = getDb();
    const sessionId = genId('ses');
    const now = new Date().toISOString();
    const eng = engine ?? 'builtin';
    db.prepare(`
    INSERT INTO sessions (session_id, user_id, title, engine, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(sessionId, userId, title ?? '新对话', eng, now, now);
    return {
        session_id: sessionId,
        user_id: userId,
        title: title ?? '新对话',
        message_count: 0,
        total_tokens: 0,
        total_cost: 0,
        summary: null,
        engine: eng,
        created_at: now,
        updated_at: now,
        archived_at: null,
    };
}
export function getSession(sessionId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId);
    return row ? rowToSession(row) : null;
}
export function listSessions(userId, limit = 50) {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM sessions WHERE user_id = ? AND archived_at IS NULL ORDER BY updated_at DESC LIMIT ?').all(userId, limit);
    return rows.map(rowToSession);
}
export function appendMessage(msg) {
    const db = getDb();
    const now = new Date().toISOString();
    const result = db.prepare(`
    INSERT INTO session_messages (session_id, role, content, tool_name, tool_call_id, tool_status, duration_ms, tokens, model, provider, cost_usd, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(msg.session_id, msg.role, msg.content, msg.tool_name ?? null, msg.tool_call_id ?? null, msg.tool_status ?? null, msg.duration_ms ?? null, msg.tokens ?? 0, msg.model ?? null, msg.provider ?? null, msg.cost_usd ?? 0, msg.metadata ? JSON.stringify(msg.metadata) : null, now);
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
export function getMessages(sessionId, opts) {
    const db = getDb();
    const limit = opts?.limit ?? 200;
    const offset = opts?.offset ?? 0;
    const rows = db.prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY id ASC LIMIT ? OFFSET ?').all(sessionId, limit, offset);
    return rows.map(rowToMessage);
}
export function updateSessionTitle(sessionId, title) {
    const db = getDb();
    db.prepare('UPDATE sessions SET title = ?, updated_at = datetime(\'now\') WHERE session_id = ?')
        .run(title, sessionId);
}
export function updateSessionSummary(sessionId, summary) {
    const db = getDb();
    db.prepare('UPDATE sessions SET summary = ?, updated_at = datetime(\'now\') WHERE session_id = ?')
        .run(summary, sessionId);
}
/** 搜索会话（按标题和消息内容） */
export function searchSessions(userId, query, limit = 20) {
    const db = getDb();
    const like = `%${query}%`;
    // 先按标题匹配，再按消息内容匹配
    const rows = db.prepare(`
    SELECT DISTINCT s.* FROM sessions s
    LEFT JOIN session_messages m ON s.session_id = m.session_id
    WHERE s.user_id = ? AND s.archived_at IS NULL
      AND (s.title LIKE ? OR m.content LIKE ?)
    ORDER BY s.updated_at DESC LIMIT ?
  `).all(userId, like, like, limit);
    return rows.map(rowToSession);
}
export function archiveSession(sessionId) {
    const db = getDb();
    db.prepare('UPDATE sessions SET archived_at = datetime(\'now\') WHERE session_id = ?')
        .run(sessionId);
}
export function deleteSession(sessionId) {
    const db = getDb();
    const del = db.transaction(() => {
        db.prepare('DELETE FROM session_messages WHERE session_id = ?').run(sessionId);
        db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
    });
    del();
}
//# sourceMappingURL=session.js.map