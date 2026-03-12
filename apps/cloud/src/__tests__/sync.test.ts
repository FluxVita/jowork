import { describe, it, expect, beforeEach } from 'vitest';
import { app } from '../server';
import { signJwt } from '../auth/jwt';
import { getSyncStore } from '../sync/push';
import { setClientConnected, setClientDisconnected } from '../sync/status';

function authHeaders(): HeadersInit {
  const token = signJwt({
    sub: 'sync_user_1',
    email: 'sync@test.com',
    name: 'Sync User',
    plan: 'pro',
  });
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

function makeRecord(
  id: string,
  entity: string,
  syncVersion = 0,
  updatedAt = Date.now(),
) {
  return { id, entity, data: { title: `Record ${id}` }, syncVersion, updatedAt };
}

describe('Sync endpoints', () => {
  beforeEach(() => {
    // Clear sync store between tests
    getSyncStore().clear();
  });

  describe('POST /sync/push', () => {
    it('accepts new records with no conflicts', async () => {
      const changes = [
        makeRecord('s1', 'session', 0),
        makeRecord('m1', 'memory', 0),
      ];

      const res = await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ changes, deviceId: 'dev_1' }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.accepted).toBe(2);
      expect(body.conflicts).toHaveLength(0);
      expect(body.serverVersion).toBeGreaterThan(0);
    });

    it('rejects missing changes array', async () => {
      const res = await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ deviceId: 'dev_1' }),
      });

      expect(res.status).toBe(400);
    });

    it('detects conflict when server has newer version', async () => {
      // First push: establish a record
      const now = Date.now();
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s1', 'session', 0, now)],
          deviceId: 'dev_1',
        }),
      });

      // Second push: same record with outdated syncVersion and older timestamp
      const res = await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s1', 'session', 0, now - 1000)],
          deviceId: 'dev_1',
        }),
      });

      const body = await res.json();
      expect(body.conflicts).toHaveLength(1);
      expect(body.conflicts[0].id).toBe('s1');
      expect(body.conflicts[0].resolution).toBe('server_wins');
      expect(body.accepted).toBe(0);
    });

    it('resolves conflict with last-writer-wins for newer timestamp', async () => {
      const now = Date.now();
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s1', 'setting', 0, now)],
          deviceId: 'dev_1',
        }),
      });

      // Push with newer timestamp → should win even with old syncVersion
      const res = await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s1', 'setting', 0, now + 5000)],
          deviceId: 'dev_1',
        }),
      });

      const body = await res.json();
      expect(body.accepted).toBe(1);
      expect(body.conflicts).toHaveLength(0);
    });

    it('always accepts messages (append-only)', async () => {
      const now = Date.now();
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('msg1', 'message', 0, now)],
          deviceId: 'dev_1',
        }),
      });

      // Push same message again with old version → should still accept
      const res = await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('msg1', 'message', 0, now - 1000)],
          deviceId: 'dev_1',
        }),
      });

      const body = await res.json();
      expect(body.accepted).toBe(1);
      expect(body.conflicts).toHaveLength(0);
    });
  });

  describe('POST /sync/pull', () => {
    it('returns empty changes when nothing pushed', async () => {
      const res = await app.request('/sync/pull', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ since: 0 }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.changes).toHaveLength(0);
      expect(body.hasMore).toBe(false);
    });

    it('returns pushed records since given version', async () => {
      // Push 3 records
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [
            makeRecord('s1', 'session'),
            makeRecord('s2', 'session'),
            makeRecord('m1', 'memory'),
          ],
          deviceId: 'dev_1',
        }),
      });

      // Pull since version 0 → get all
      const res = await app.request('/sync/pull', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ since: 0 }),
      });

      const body = await res.json();
      expect(body.changes).toHaveLength(3);
      expect(body.serverVersion).toBeGreaterThan(0);
    });

    it('respects since watermark', async () => {
      // Push first batch
      const push1 = await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s1', 'session')],
          deviceId: 'dev_1',
        }),
      });
      const { serverVersion: v1 } = await push1.json();

      // Push second batch
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s2', 'session')],
          deviceId: 'dev_1',
        }),
      });

      // Pull since v1 → only get second record
      const res = await app.request('/sync/pull', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ since: v1 }),
      });

      const body = await res.json();
      expect(body.changes).toHaveLength(1);
      expect(body.changes[0].id).toBe('s2');
    });

    it('filters by entity type', async () => {
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [
            makeRecord('s1', 'session'),
            makeRecord('m1', 'memory'),
            makeRecord('msg1', 'message'),
          ],
          deviceId: 'dev_1',
        }),
      });

      const res = await app.request('/sync/pull', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ since: 0, entities: ['memory'] }),
      });

      const body = await res.json();
      expect(body.changes).toHaveLength(1);
      expect(body.changes[0].entity).toBe('memory');
    });

    it('respects limit and reports hasMore', async () => {
      const changes = Array.from({ length: 5 }, (_, i) =>
        makeRecord(`r${i}`, 'session'),
      );
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ changes, deviceId: 'dev_1' }),
      });

      const res = await app.request('/sync/pull', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ since: 0, limit: 3 }),
      });

      const body = await res.json();
      expect(body.changes).toHaveLength(3);
      expect(body.hasMore).toBe(true);
    });

    it('isolates data between users', async () => {
      // Push as sync_user_1
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s1', 'session')],
          deviceId: 'dev_1',
        }),
      });

      // Pull as different user
      const otherToken = signJwt({
        sub: 'sync_user_2',
        email: 'other@test.com',
        name: 'Other',
        plan: 'free',
      });
      const res = await app.request('/sync/pull', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${otherToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ since: 0 }),
      });

      const body = await res.json();
      expect(body.changes).toHaveLength(0);
    });
  });

  describe('GET /sync/status', () => {
    it('returns initial status with no records', async () => {
      const res = await app.request('/sync/status', {
        headers: authHeaders(),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.pendingCount).toBe(0);
      expect(body.connected).toBe(false);
    });

    it('reflects connected state', async () => {
      setClientConnected('sync_user_1', 'dev_1');

      const res = await app.request('/sync/status', {
        headers: authHeaders(),
      });
      const body = await res.json();
      expect(body.connected).toBe(true);

      setClientDisconnected('sync_user_1');

      const res2 = await app.request('/sync/status', {
        headers: authHeaders(),
      });
      const body2 = await res2.json();
      expect(body2.connected).toBe(false);
    });

    it('tracks serverVersion after pushes', async () => {
      await app.request('/sync/push', {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          changes: [makeRecord('s1', 'session')],
          deviceId: 'dev_1',
        }),
      });

      const res = await app.request('/sync/status', {
        headers: authHeaders(),
      });
      const body = await res.json();
      expect(body.serverVersion).toBeGreaterThan(0);
    });
  });

  describe('Auth requirement', () => {
    it('rejects push without token', async () => {
      const res = await app.request('/sync/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes: [], deviceId: 'd' }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects pull without token', async () => {
      const res = await app.request('/sync/pull', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ since: 0 }),
      });
      expect(res.status).toBe(401);
    });

    it('rejects status without token', async () => {
      const res = await app.request('/sync/status');
      expect(res.status).toBe(401);
    });
  });
});
