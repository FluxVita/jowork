import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { logInfo, logError } from '../utils/logger.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { joworkDir } from '../utils/paths.js';

/**
 * Get or create a stable device ID for this machine.
 */
export function getDeviceId(): string {
  const idPath = join(joworkDir(), 'device-id');
  if (existsSync(idPath)) {
    return readFileSync(idPath, 'utf-8').trim();
  }
  const id = createId('dev');
  writeFileSync(idPath, id);
  return id;
}

/**
 * Record a change in the sync queue for eventual device sync.
 */
export function recordChange(
  sqlite: Database.Database,
  tableName: string,
  recordId: string,
  operation: 'insert' | 'update' | 'delete',
  data?: Record<string, unknown>,
): void {
  const deviceId = getDeviceId();
  const id = createId('sq');
  sqlite.prepare(`
    INSERT INTO sync_queue (id, table_name, record_id, operation, data, version, device_id, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?)
  `).run(id, tableName, recordId, operation, data ? JSON.stringify(data) : null, deviceId, Date.now());
}

/**
 * Get unsynced changes for export to another device.
 */
export function getUnsyncedChanges(sqlite: Database.Database, limit: number = 100): Array<{
  id: string;
  tableName: string;
  recordId: string;
  operation: string;
  data: string | null;
  version: number;
  deviceId: string;
  createdAt: number;
}> {
  return sqlite.prepare(`
    SELECT id, table_name as tableName, record_id as recordId, operation, data, version, device_id as deviceId, created_at as createdAt
    FROM sync_queue
    WHERE synced_at IS NULL
    ORDER BY created_at ASC
    LIMIT ?
  `).all(limit) as Array<{
    id: string; tableName: string; recordId: string; operation: string;
    data: string | null; version: number; deviceId: string; createdAt: number;
  }>;
}

/**
 * Apply changes from another device (CAS optimistic concurrency).
 * Returns { applied, conflicts, skipped }.
 */
export function applyRemoteChanges(
  sqlite: Database.Database,
  changes: Array<{
    tableName: string;
    recordId: string;
    operation: string;
    data: string | null;
    version: number;
    deviceId: string;
    createdAt: number;
  }>,
): { applied: number; conflicts: number; skipped: number } {
  const myDeviceId = getDeviceId();
  let applied = 0, conflicts = 0, skipped = 0;

  const batch = sqlite.transaction(() => {
    for (const change of changes) {
      // Skip our own changes
      if (change.deviceId === myDeviceId) { skipped++; continue; }

      // Check for version conflicts (CAS)
      const existing = sqlite.prepare(
        `SELECT version FROM sync_queue WHERE table_name = ? AND record_id = ? AND device_id != ? ORDER BY created_at DESC LIMIT 1`,
      ).get(change.tableName, change.recordId, change.deviceId) as { version: number } | undefined;

      if (existing && existing.version >= change.version) {
        conflicts++;
        logInfo('device-sync', `Conflict: ${change.tableName}/${change.recordId} (local v${existing.version} >= remote v${change.version})`);
        continue;
      }

      // Apply the change
      try {
        if (change.operation === 'delete') {
          sqlite.prepare(`DELETE FROM "${change.tableName}" WHERE id = ?`).run(change.recordId);
        } else if (change.data) {
          const data = JSON.parse(change.data) as Record<string, unknown>;
          if (change.operation === 'insert') {
            const cols = Object.keys(data);
            const placeholders = cols.map(() => '?').join(', ');
            sqlite.prepare(
              `INSERT OR REPLACE INTO "${change.tableName}" (${cols.join(', ')}) VALUES (${placeholders})`,
            ).run(...Object.values(data));
          } else if (change.operation === 'update') {
            const sets = Object.keys(data).filter(k => k !== 'id').map(k => `"${k}" = ?`).join(', ');
            const vals = Object.keys(data).filter(k => k !== 'id').map(k => data[k]);
            sqlite.prepare(
              `UPDATE "${change.tableName}" SET ${sets} WHERE id = ?`,
            ).run(...vals, change.recordId);
          }
        }

        // Record the remote change in our sync_queue for tracking
        const sqId = createId('sq');
        sqlite.prepare(`
          INSERT INTO sync_queue (id, table_name, record_id, operation, data, version, device_id, created_at, synced_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(sqId, change.tableName, change.recordId, change.operation, change.data, change.version, change.deviceId, change.createdAt, Date.now());

        applied++;
      } catch (err) {
        conflicts++;
        logError('device-sync', `Failed to apply ${change.operation} on ${change.tableName}/${change.recordId}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  batch();
  logInfo('device-sync', `Applied ${applied}, conflicts ${conflicts}, skipped ${skipped}`);
  return { applied, conflicts, skipped };
}

/**
 * Mark changes as synced after successful export.
 */
export function markSynced(sqlite: Database.Database, changeIds: string[]): void {
  const now = Date.now();
  const stmt = sqlite.prepare('UPDATE sync_queue SET synced_at = ? WHERE id = ?');
  const batch = sqlite.transaction(() => {
    for (const id of changeIds) {
      stmt.run(now, id);
    }
  });
  batch();
}

/**
 * Export sync bundle as JSON (for file-based sync between devices).
 */
export function exportSyncBundle(sqlite: Database.Database): string {
  const changes = getUnsyncedChanges(sqlite, 1000);
  const bundle = {
    version: 1,
    deviceId: getDeviceId(),
    exportedAt: Date.now(),
    changes,
  };
  return JSON.stringify(bundle, null, 2);
}

/**
 * Import sync bundle from another device.
 */
export function importSyncBundle(
  sqlite: Database.Database,
  bundleJson: string,
): { applied: number; conflicts: number; skipped: number } {
  const bundle = JSON.parse(bundleJson) as {
    version: number;
    deviceId: string;
    exportedAt: number;
    changes: Array<{
      tableName: string; recordId: string; operation: string;
      data: string | null; version: number; deviceId: string; createdAt: number;
    }>;
  };
  return applyRemoteChanges(sqlite, bundle.changes);
}
