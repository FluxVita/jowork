import type Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc, like, or } from 'drizzle-orm';
import { memories, createId } from '@jowork/core';

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
  accessCount: number;
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
      accessCount: 0,
      lastUsedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(memories).values(row).run();

    // Maintain FTS index
    try {
      const rowid = this.sqlite.prepare('SELECT rowid FROM memories WHERE id = ?').get(id) as { rowid: number } | undefined;
      if (rowid) {
        this.sqlite.prepare(
          'INSERT INTO memories_fts(rowid, title, content, tags) VALUES (?, ?, ?, ?)',
        ).run(rowid.rowid, mem.title, mem.content, row.tags);
      }
    } catch {
      // FTS maintenance is non-critical
    }

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
    // Remove from FTS before deleting
    try {
      const row = this.sqlite.prepare('SELECT rowid, title, content, tags FROM memories WHERE id = ?').get(id) as {
        rowid: number; title: string; content: string; tags: string;
      } | undefined;
      if (row) {
        this.sqlite.prepare(
          `INSERT INTO memories_fts(memories_fts, rowid, title, content, tags) VALUES ('delete', ?, ?, ?, ?)`,
        ).run(row.rowid, row.title, row.content, row.tags ?? '');
      }
    } catch {
      // FTS cleanup is non-critical
    }
    this.db.delete(memories).where(eq(memories.id, id)).run();
  }

  list(opts: { scope?: string; pinned?: boolean; limit?: number; offset?: number } = {}): MemoryRecord[] {
    const { limit = 50, offset = 0 } = opts;
    let rows = this.db
      .select()
      .from(memories)
      .orderBy(desc(memories.updatedAt))
      .limit(limit)
      .offset(offset)
      .all();

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
    const rows = this.db
      .select()
      .from(memories)
      .where(
        or(
          like(memories.title, pattern),
          like(memories.content, pattern),
          like(memories.tags, pattern),
        ),
      )
      .orderBy(desc(memories.updatedAt))
      .limit(20)
      .all();
    return rows.map((r) => this.toRecord(r));
  }

  touchUsed(id: string): void {
    const now = Date.now();
    this.sqlite
      .prepare('UPDATE memories SET last_used_at = ?, access_count = access_count + 1 WHERE id = ?')
      .run(now, id);
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
      accessCount: row.accessCount ?? 0,
      lastUsedAt: row.lastUsedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
