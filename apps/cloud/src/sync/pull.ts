import type { Context } from 'hono';
import type { SyncPullResponse, SyncEntity } from '@jowork/core';
import { getSyncStore, getGlobalVersion } from './push';

/**
 * POST /sync/pull — pull changes from cloud since a given version
 */
export async function handlePull(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const body = await c.req.json() as { since: number; entities?: SyncEntity[]; limit?: number };
  const since = body.since ?? 0;
  const limit = body.limit ?? 500;
  const entities = body.entities ? new Set(body.entities) : null;

  const store = getSyncStore();
  const prefix = `${userId}:`;
  const changes = [];

  for (const [key, record] of store) {
    if (!key.startsWith(prefix)) continue;
    if (record.syncVersion <= since) continue;
    if (entities && !entities.has(record.entity)) continue;
    changes.push(record);
  }

  // Sort by syncVersion ascending
  changes.sort((a, b) => a.syncVersion - b.syncVersion);

  const truncated = changes.slice(0, limit);

  const response: SyncPullResponse = {
    changes: truncated,
    serverVersion: getGlobalVersion(),
    hasMore: changes.length > limit,
  };

  return c.json(response);
}
