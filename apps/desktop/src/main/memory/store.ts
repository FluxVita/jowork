import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc, like, or, and } from 'drizzle-orm';
import { memories } from '@jowork/core';
import { createId } from '@jowork/core';

export interface NewMemory {
  title: string;
  content: string;
  tags?: string[];
  scope?: 'personal' | 'team';
  pinned?: boolean;
  source?: 'user' | 'auto';
}

export interface MemoryRecord {
  id: string;
  title: string;
  content: string;
  tags: string[];
  scope: string;
  pinned: boolean;
  source: string;
  lastUsedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export class MemoryStore {
  private db: BetterSQLite3Database;
  private sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
    this.db = drizzle(sqlite);
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        tags TEXT,
        scope TEXT NOT NULL DEFAULT 'personal',
        pinned INTEGER DEFAULT 0,
        source TEXT,
        last_used_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
    `);
  }

  create(mem: NewMemory): MemoryRecord {
    const now = Date.now();
    const id = createId('mem');
    const row = {
      id,
      title: mem.title,
      content: mem.content,
      tags: JSON.stringify(mem.tags ?? []),
      scope: mem.scope ?? 'personal',
      pinned: mem.pinned ? 1 : 0,
      source: mem.source ?? 'user',
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(memories).values(row).run();
    return this.toRecord(row);
  }

  update(id: string, patch: Partial<NewMemory>): MemoryRecord | null {
    const now = Date.now();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.content !== undefined) updates.content = patch.content;
    if (patch.tags !== undefined) updates.tags = JSON.stringify(patch.tags);
    if (patch.scope !== undefined) updates.scope = patch.scope;
    if (patch.pinned !== undefined) updates.pinned = patch.pinned ? 1 : 0;
    if (patch.source !== undefined) updates.source = patch.source;

    this.db.update(memories).set(updates).where(eq(memories.id, id)).run();
    const row = this.db.select().from(memories).where(eq(memories.id, id)).get();
    return row ? this.toRecord(row) : null;
  }

  delete(id: string): void {
    this.db.delete(memories).where(eq(memories.id, id)).run();
  }

  list(opts: { scope?: string; pinned?: boolean; limit?: number; offset?: number } = {}): MemoryRecord[] {
    const { limit = 50, offset = 0 } = opts;
    let rows = this.db.select().from(memories).orderBy(desc(memories.updatedAt)).limit(limit).offset(offset).all();

    if (opts.scope) {
      rows = rows.filter((r) => r.scope === opts.scope);
    }
    if (opts.pinned !== undefined) {
      rows = rows.filter((r) => (r.pinned === 1) === opts.pinned);
    }

    return rows.map((r) => this.toRecord(r));
  }

  search(query: string): MemoryRecord[] {
    const pattern = `%${query}%`;
    const rows = this.db.select().from(memories)
      .where(or(
        like(memories.title, pattern),
        like(memories.content, pattern),
        like(memories.tags, pattern),
      ))
      .orderBy(desc(memories.updatedAt))
      .limit(20)
      .all();
    return rows.map((r) => this.toRecord(r));
  }

  touchUsed(id: string): void {
    this.db.update(memories).set({ lastUsedAt: Date.now() }).where(eq(memories.id, id)).run();
  }

  get(id: string): MemoryRecord | null {
    const row = this.db.select().from(memories).where(eq(memories.id, id)).get();
    return row ? this.toRecord(row) : null;
  }

  private toRecord(row: typeof memories.$inferSelect): MemoryRecord {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      tags: row.tags ? JSON.parse(row.tags) : [],
      scope: row.scope,
      pinned: row.pinned === 1,
      source: row.source ?? 'user',
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
