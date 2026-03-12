import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc } from 'drizzle-orm';
import { contextDocs } from '@jowork/core';
import { createId } from '@jowork/core';

export interface ContextDoc {
  id: string;
  title: string;
  content: string;
  scope: 'personal' | 'team';
  category: string;
  priority: number;
  createdAt: number;
  updatedAt: number;
}

export class ContextDocsStore {
  private db: BetterSQLite3Database;
  private sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
    this.db = drizzle(sqlite);
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS context_docs (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'personal',
        category TEXT,
        priority INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  create(doc: Omit<ContextDoc, 'id' | 'createdAt' | 'updatedAt'>): ContextDoc {
    const now = Date.now();
    const id = createId('doc');
    const row = { id, ...doc, createdAt: now, updatedAt: now };
    this.db.insert(contextDocs).values(row).run();
    return row;
  }

  update(id: string, patch: Partial<Omit<ContextDoc, 'id' | 'createdAt'>>): ContextDoc | null {
    const now = Date.now();
    this.db.update(contextDocs).set({ ...patch, updatedAt: now }).where(eq(contextDocs.id, id)).run();
    return this.get(id);
  }

  delete(id: string): void {
    this.db.delete(contextDocs).where(eq(contextDocs.id, id)).run();
  }

  get(id: string): ContextDoc | null {
    const row = this.db.select().from(contextDocs).where(eq(contextDocs.id, id)).get();
    return row ? this.toDoc(row) : null;
  }

  listByScope(scope: 'personal' | 'team'): ContextDoc[] {
    return this.db.select().from(contextDocs)
      .where(eq(contextDocs.scope, scope))
      .orderBy(desc(contextDocs.priority))
      .all()
      .map((r) => this.toDoc(r));
  }

  private toDoc(row: typeof contextDocs.$inferSelect): ContextDoc {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      scope: row.scope as 'personal' | 'team',
      category: row.category ?? 'standard',
      priority: row.priority ?? 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
