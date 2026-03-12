import Database from 'better-sqlite3';
import type { SyncRecord, SyncEntity } from '@jowork/core';
import { createId } from '@jowork/core';

/**
 * Offline queue: stores pending sync operations when the device is offline.
 * Operations are FIFO-ordered and automatically flushed when connectivity returns.
 */
export class OfflineQueue {
  private sqlite: Database.Database;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
    this.ensureTable();
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sync_queue (
        id TEXT PRIMARY KEY,
        entity TEXT NOT NULL,
        record_id TEXT NOT NULL,
        data TEXT NOT NULL,
        sync_version INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        deleted_at INTEGER,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_queue_created ON sync_queue(created_at);
    `);
  }

  enqueue(record: SyncRecord): void {
    // Deduplicate: if same entity+id already queued, update instead of insert
    const existing = this.sqlite
      .prepare('SELECT id FROM sync_queue WHERE entity = ? AND record_id = ?')
      .get(record.entity, record.id) as { id: string } | undefined;

    if (existing) {
      this.sqlite
        .prepare('UPDATE sync_queue SET data = ?, updated_at = ?, deleted_at = ? WHERE id = ?')
        .run(JSON.stringify(record.data), record.updatedAt, record.deletedAt ?? null, existing.id);
    } else {
      this.sqlite
        .prepare('INSERT INTO sync_queue (id, entity, record_id, data, sync_version, updated_at, deleted_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(createId('sq'), record.entity, record.id, JSON.stringify(record.data), record.syncVersion, record.updatedAt, record.deletedAt ?? null, Date.now());
    }
  }

  /** Get all pending records, oldest first. */
  drain(limit = 100): SyncRecord[] {
    const rows = this.sqlite
      .prepare('SELECT * FROM sync_queue ORDER BY created_at ASC LIMIT ?')
      .all(limit) as Array<{
        id: string;
        entity: string;
        record_id: string;
        data: string;
        sync_version: number;
        updated_at: number;
        deleted_at: number | null;
      }>;

    return rows.map((r) => ({
      id: r.record_id,
      entity: r.entity as SyncEntity,
      data: JSON.parse(r.data),
      syncVersion: r.sync_version,
      updatedAt: r.updated_at,
      deletedAt: r.deleted_at ?? undefined,
    }));
  }

  /** Remove records that were successfully pushed. */
  remove(recordIds: string[]): void {
    if (recordIds.length === 0) return;
    const placeholders = recordIds.map(() => '?').join(',');
    this.sqlite
      .prepare(`DELETE FROM sync_queue WHERE record_id IN (${placeholders})`)
      .run(...recordIds);
  }

  /** Number of pending items. */
  count(): number {
    const row = this.sqlite.prepare('SELECT COUNT(*) as n FROM sync_queue').get() as { n: number };
    return row.n;
  }

  clear(): void {
    this.sqlite.exec('DELETE FROM sync_queue');
  }
}
