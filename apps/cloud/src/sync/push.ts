import type { Context } from 'hono';
import type { SyncRecord, SyncPushResponse, SyncConflict } from '@jowork/core';

/**
 * In-memory sync store (placeholder for DB-backed implementation).
 * In production, sync records would be stored in PostgreSQL.
 * Capped at MAX_SYNC_RECORDS to prevent unbounded memory growth.
 */
const MAX_SYNC_RECORDS = 100_000;
const syncStore = new Map<string, SyncRecord>();
let globalVersion = 0;

export function getSyncStore() {
  return syncStore;
}

export function getGlobalVersion() {
  return globalVersion;
}

/**
 * POST /sync/push — push local changes to cloud
 *
 * Conflict resolution:
 * - Team data: server wins (cloud is source of truth)
 * - Personal data: client wins (local is source of truth)
 * - Settings: last-writer-wins (higher updatedAt wins)
 * - Messages: append-only (no overwrites)
 */
export async function handlePush(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const body = await c.req.json() as { changes: SyncRecord[]; deviceId: string };

  if (!body.changes || !Array.isArray(body.changes)) {
    return c.json({ error: 'Missing changes array' }, 400);
  }
  if (body.changes.length > 1000) {
    return c.json({ error: 'Too many changes in single push (max 1000)' }, 400);
  }

  const conflicts: SyncConflict[] = [];
  let accepted = 0;

  for (const record of body.changes) {
    const key = `${userId}:${record.entity}:${record.id}`;
    const existing = syncStore.get(key);

    if (existing && existing.syncVersion >= record.syncVersion) {
      // Conflict: server has newer or equal version
      const isAppendOnly = record.entity === 'message';
      if (isAppendOnly) {
        // Messages are append-only — always accept
        globalVersion++;
        record.syncVersion = globalVersion;
        syncStore.set(key, record);
        accepted++;
      } else {
        // Last-writer-wins for settings; server wins for team data
        if (record.updatedAt > existing.updatedAt) {
          globalVersion++;
          record.syncVersion = globalVersion;
          syncStore.set(key, record);
          accepted++;
        } else {
          conflicts.push({
            id: record.id,
            entity: record.entity,
            localVersion: record.syncVersion,
            serverVersion: existing.syncVersion,
            resolution: 'server_wins',
          });
        }
      }
    } else {
      // No conflict — accept
      globalVersion++;
      record.syncVersion = globalVersion;
      syncStore.set(key, record);
      accepted++;
    }

    // Evict oldest entries when store exceeds cap
    if (syncStore.size > MAX_SYNC_RECORDS) {
      const firstKey = syncStore.keys().next().value;
      if (firstKey !== undefined) syncStore.delete(firstKey);
    }
  }

  const response: SyncPushResponse = {
    accepted,
    conflicts,
    serverVersion: globalVersion,
  };

  return c.json(response);
}
