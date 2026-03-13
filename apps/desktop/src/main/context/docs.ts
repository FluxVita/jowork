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

interface CloudContextDoc {
  id: string;
  title: string;
  content: string;
  scope: string;
  category: string | null;
  priority: number | null;
  createdAt: string;
  updatedAt: string;
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
      CREATE INDEX IF NOT EXISTS idx_context_docs_scope ON context_docs(scope, priority);
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

  /**
   * Sync team docs from cloud API to local cache.
   * Cloud is the source of truth for team-scoped docs.
   * Upserts cloud docs locally and removes local team docs that no longer exist in cloud.
   */
  async syncTeamDocs(apiUrl: string, token: string, teamId: string): Promise<{ synced: number; removed: number }> {
    const res = await fetch(`${apiUrl}/teams/${teamId}/context-docs`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch team docs: ${res.status}`);
    }

    const cloudDocs = await res.json() as CloudContextDoc[];
    const cloudIds = new Set(cloudDocs.map((d) => d.id));

    // Upsert cloud docs into local DB
    let synced = 0;
    for (const doc of cloudDocs) {
      const existing = this.get(doc.id);
      const createdAt = new Date(doc.createdAt).getTime();
      const updatedAt = new Date(doc.updatedAt).getTime();

      if (existing) {
        // Update if cloud version is newer
        if (updatedAt > existing.updatedAt) {
          this.db.update(contextDocs).set({
            title: doc.title,
            content: doc.content,
            category: doc.category ?? 'standard',
            priority: doc.priority ?? 0,
            updatedAt,
          }).where(eq(contextDocs.id, doc.id)).run();
          synced++;
        }
      } else {
        this.db.insert(contextDocs).values({
          id: doc.id,
          title: doc.title,
          content: doc.content,
          scope: 'team',
          category: doc.category ?? 'standard',
          priority: doc.priority ?? 0,
          createdAt,
          updatedAt,
        }).run();
        synced++;
      }
    }

    // Remove local team docs that no longer exist in cloud
    const localTeamDocs = this.listByScope('team');
    let removed = 0;
    for (const local of localTeamDocs) {
      if (!cloudIds.has(local.id)) {
        this.delete(local.id);
        removed++;
      }
    }

    return { synced, removed };
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
