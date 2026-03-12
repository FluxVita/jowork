import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc, and } from 'drizzle-orm';
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
    `);
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

  getSqliteInstance(): Database.Database {
    return this.sqlite;
  }

  close(): void {
    this.sqlite.close();
  }
}
