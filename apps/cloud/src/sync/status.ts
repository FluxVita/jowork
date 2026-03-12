import type { Context } from 'hono';
import type { SyncStatus } from '@jowork/core';
import { getSyncStore, getGlobalVersion } from './push';

/** Connected clients — tracks which users have an active WebSocket. */
const connectedClients = new Map<string, { deviceId: string; connectedAt: number }>();

export function setClientConnected(userId: string, deviceId: string): void {
  connectedClients.set(userId, { deviceId, connectedAt: Date.now() });
}

export function setClientDisconnected(userId: string): void {
  connectedClients.delete(userId);
}

export function isClientOnline(userId: string): boolean {
  return connectedClients.has(userId);
}

/**
 * GET /sync/status — current sync status for the authenticated user
 */
export async function handleStatus(c: Context): Promise<Response> {
  const userId = c.get('userId');

  const store = getSyncStore();
  const prefix = `${userId}:`;
  let recordCount = 0;
  let latestSync = 0;

  for (const [key, record] of store) {
    if (!key.startsWith(prefix)) continue;
    recordCount++;
    if (record.updatedAt > latestSync) latestSync = record.updatedAt;
  }

  const status: SyncStatus = {
    lastSyncAt: latestSync,
    pendingCount: 0, // Server doesn't track client pending — client knows its own
    serverVersion: getGlobalVersion(),
    connected: isClientOnline(userId),
  };

  return c.json(status);
}
