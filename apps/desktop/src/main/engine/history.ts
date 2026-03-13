import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc, and, lt, asc } from 'drizzle-orm';
import { sessions, messages, engineSessionMappings, settings } from '@jowork/core';
import { createId } from '@jowork/core';
import type { Session, Message, EngineId } from '@jowork/core';

export class HistoryManager {
  private db: BetterSQLite3Database;
  private sqlite: Database.Database;

  constructor(dbPath: string) {
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite);
    this.ensureTables();
  }

  private ensureTables(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        engine_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'personal',
        message_count INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id),
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_name TEXT,
        tokens INTEGER,
        cost INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS engine_session_mappings (
        session_id TEXT NOT NULL REFERENCES sessions(id),
        engine_id TEXT NOT NULL,
        engine_session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (session_id, engine_id)
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

      -- Phase 2: Connector data tables (queried by MCP server)
      CREATE TABLE IF NOT EXISTS connector_configs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'disconnected',
        config TEXT NOT NULL DEFAULT '{}',
        last_sync_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS objects (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_type TEXT NOT NULL,
        uri TEXT NOT NULL UNIQUE,
        title TEXT,
        summary TEXT,
        tags TEXT,
        last_synced_at INTEGER,
        created_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS object_bodies (
        object_id TEXT PRIMARY KEY REFERENCES objects(id),
        content TEXT NOT NULL,
        content_type TEXT,
        fetched_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sync_cursors (
        connector_id TEXT PRIMARY KEY,
        cursor TEXT,
        last_synced_at INTEGER
      );
    `);

    // FTS5 virtual tables — doesn't support IF NOT EXISTS, check manually
    const ftsCheck = this.sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('objects_fts', 'messages_fts')`,
    ).all() as Array<{ name: string }>;
    const existingFts = new Set(ftsCheck.map((r) => r.name));

    if (!existingFts.has('objects_fts')) {
      this.sqlite.exec(`
        CREATE VIRTUAL TABLE objects_fts USING fts5(
          title, summary, tags, source, source_type,
          content=''
        );
      `);
    }

    if (!existingFts.has('messages_fts')) {
      this.sqlite.exec(`
        CREATE VIRTUAL TABLE messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='rowid'
        );
      `);
      // Backfill existing messages (only user + assistant, skip tool noise)
      this.sqlite.exec(`
        INSERT INTO messages_fts(rowid, content)
        SELECT rowid, content FROM messages WHERE role IN ('user', 'assistant');
      `);
    }
  }

  createSession(engineId: EngineId, title?: string): Session {
    const now = Date.now();
    const id = createId('ses');
    const row = {
      id,
      title: title || 'New Conversation',
      engineId,
      mode: 'personal' as const,
      messageCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(sessions).values(row).run();

    return {
      ...row,
      createdAt: new Date(now),
      updatedAt: new Date(now),
    };
  }

  getEngineSessionId(sessionId: string, engineId: EngineId): string | null {
    const result = this.db
      .select()
      .from(engineSessionMappings)
      .where(
        and(
          eq(engineSessionMappings.sessionId, sessionId),
          eq(engineSessionMappings.engineId, engineId),
        ),
      )
      .get();

    return result?.engineSessionId ?? null;
  }

  bindEngineSession(sessionId: string, engineId: EngineId, engineSessionId: string): void {
    const now = Date.now();
    this.db
      .insert(engineSessionMappings)
      .values({ sessionId, engineId, engineSessionId, createdAt: now })
      .onConflictDoUpdate({
        target: [engineSessionMappings.sessionId, engineSessionMappings.engineId],
        set: { engineSessionId, createdAt: now },
      })
      .run();
  }

  appendMessage(sessionId: string, msg: Omit<Message, 'id' | 'createdAt'>): Message {
    const now = Date.now();
    const id = createId('msg');
    const row = {
      id,
      sessionId,
      role: msg.role,
      content: msg.content,
      toolName: msg.toolName ?? null,
      tokens: msg.tokens ?? null,
      cost: msg.cost ?? null,
      createdAt: now,
    };

    this.db.insert(messages).values(row).run();

    // Maintain FTS index for user/assistant messages
    if (msg.role === 'user' || msg.role === 'assistant') {
      try {
        const rowid = this.sqlite.prepare('SELECT rowid FROM messages WHERE id = ?').get(id) as { rowid: number } | undefined;
        if (rowid) {
          this.sqlite.prepare('INSERT INTO messages_fts(rowid, content) VALUES (?, ?)').run(rowid.rowid, msg.content);
        }
      } catch (err) {
        console.warn('[FTS] Failed to index message', id, err);
      }
    }

    // Update session message count and timestamp
    this.sqlite.prepare(
      'UPDATE sessions SET message_count = message_count + 1, updated_at = ? WHERE id = ?',
    ).run(now, sessionId);

    return {
      ...row,
      toolName: msg.toolName,
      tokens: msg.tokens,
      cost: msg.cost,
      createdAt: new Date(now),
    };
  }

  listSessions(opts: { mode?: string; limit?: number; offset?: number } = {}): Session[] {
    const { limit = 50, offset = 0 } = opts;
    const rows = this.db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();

    return rows.map((r) => ({
      ...r,
      mode: r.mode as 'personal' | 'team',
      engineId: r.engineId as EngineId,
      messageCount: r.messageCount ?? 0,
      createdAt: new Date(r.createdAt),
      updatedAt: new Date(r.updatedAt),
    }));
  }

  getMessages(sessionId: string): Message[] {
    const rows = this.db
      .select()
      .from(messages)
      .where(eq(messages.sessionId, sessionId))
      .all();

    return rows.map((r) => ({
      ...r,
      role: r.role as Message['role'],
      toolName: r.toolName ?? undefined,
      tokens: r.tokens ?? undefined,
      cost: r.cost ?? undefined,
      createdAt: new Date(r.createdAt),
    }));
  }

  /**
   * Paginated message loading. Returns messages in ascending order (oldest first).
   * Uses rowid for stable ordering (createdAt can be identical for rapid inserts).
   * - limit: max messages to return (default 40)
   * - beforeId: cursor — only return messages with rowid < this message's rowid
   * Returns { messages, hasMore }
   */
  getMessagesPaginated(
    sessionId: string,
    opts: { limit?: number; beforeId?: string } = {},
  ): { messages: Message[]; hasMore: boolean } {
    const limit = opts.limit ?? 40;

    // Use raw SQL with rowid for stable cursor-based pagination
    let sql: string;
    let params: unknown[];

    if (opts.beforeId) {
      sql = `SELECT * FROM messages
             WHERE session_id = ? AND rowid < (SELECT rowid FROM messages WHERE id = ?)
             ORDER BY rowid DESC LIMIT ?`;
      params = [sessionId, opts.beforeId, limit + 1];
    } else {
      sql = `SELECT * FROM messages WHERE session_id = ? ORDER BY rowid DESC LIMIT ?`;
      params = [sessionId, limit + 1];
    }

    const rows = this.sqlite.prepare(sql).all(...params) as Array<{
      id: string; session_id: string; role: string; content: string;
      tool_name: string | null; tokens: number | null; cost: number | null; created_at: number;
    }>;

    const hasMore = rows.length > limit;
    const sliced = rows.slice(0, limit).reverse(); // ascending order

    return {
      messages: sliced.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role as Message['role'],
        content: r.content,
        toolName: r.tool_name ?? undefined,
        tokens: r.tokens ?? undefined,
        cost: r.cost ?? undefined,
        createdAt: new Date(r.created_at),
      })),
      hasMore,
    };
  }

  getSession(sessionId: string): Session | null {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .get();

    if (!row) return null;
    return {
      ...row,
      mode: row.mode as 'personal' | 'team',
      engineId: row.engineId as EngineId,
      messageCount: row.messageCount ?? 0,
      createdAt: new Date(row.createdAt),
      updatedAt: new Date(row.updatedAt),
    };
  }

  deleteSession(sessionId: string): void {
    // Remove FTS entries before deleting messages
    try {
      this.sqlite.prepare(`
        INSERT INTO messages_fts(messages_fts, rowid, content)
        SELECT 'delete', m.rowid, m.content FROM messages m
        WHERE m.session_id = ? AND m.role IN ('user', 'assistant')
      `).run(sessionId);
    } catch {
      // FTS cleanup is non-critical
    }
    this.sqlite.prepare('DELETE FROM messages WHERE session_id = ?').run(sessionId);
    this.sqlite.prepare('DELETE FROM engine_session_mappings WHERE session_id = ?').run(sessionId);
    this.sqlite.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  renameSession(sessionId: string, title: string): void {
    const now = Date.now();
    this.db
      .update(sessions)
      .set({ title, updatedAt: now })
      .where(eq(sessions.id, sessionId))
      .run();
  }

  rebuildContextForEngine(sessionId: string): string {
    const msgs = this.getMessages(sessionId);
    return msgs
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n\n');
  }

  getSetting(key: string): string | null {
    const row = this.db
      .select()
      .from(settings)
      .where(eq(settings.key, key))
      .get();
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    const now = Date.now();
    this.db
      .insert(settings)
      .values({ key, value, updatedAt: now })
      .onConflictDoUpdate({
        target: settings.key,
        set: { value, updatedAt: now },
      })
      .run();
  }

  /**
   * Full-text search across messages. Uses FTS5 with LIKE fallback.
   * Returns matching messages with their session info.
   */
  searchMessages(query: string, opts: { limit?: number } = {}): Array<{
    messageId: string;
    sessionId: string;
    sessionTitle: string;
    role: string;
    snippet: string;
    createdAt: Date;
  }> {
    const limit = opts.limit ?? 20;

    // Try FTS5 first
    try {
      const rows = this.sqlite.prepare(`
        SELECT m.id, m.session_id, s.title as session_title, m.role,
               snippet(messages_fts, 0, '**', '**', '...', 40) as snippet,
               m.created_at
        FROM messages_fts f
        JOIN messages m ON m.rowid = f.rowid
        JOIN sessions s ON s.id = m.session_id
        WHERE messages_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(query, limit) as Array<{
        id: string; session_id: string; session_title: string;
        role: string; snippet: string; created_at: number;
      }>;

      if (rows.length > 0) {
        return rows.map((r) => ({
          messageId: r.id,
          sessionId: r.session_id,
          sessionTitle: r.session_title,
          role: r.role,
          snippet: r.snippet,
          createdAt: new Date(r.created_at),
        }));
      }
    } catch {
      // FTS unavailable, fall through to LIKE
    }

    // LIKE fallback
    const pattern = `%${query}%`;
    const rows = this.sqlite.prepare(`
      SELECT m.id, m.session_id, s.title as session_title, m.role,
             substr(m.content, max(1, instr(lower(m.content), lower(?)) - 40), 120) as snippet,
             m.created_at
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE m.role IN ('user', 'assistant') AND m.content LIKE ?
      ORDER BY m.created_at DESC
      LIMIT ?
    `).all(query, pattern, limit) as Array<{
      id: string; session_id: string; session_title: string;
      role: string; snippet: string; created_at: number;
    }>;

    return rows.map((r) => ({
      messageId: r.id,
      sessionId: r.session_id,
      sessionTitle: r.session_title,
      role: r.role,
      snippet: r.snippet,
      createdAt: new Date(r.created_at),
    }));
  }

  getSqliteInstance(): Database.Database {
    return this.sqlite;
  }

  close(): void {
    this.sqlite.close();
  }
}
