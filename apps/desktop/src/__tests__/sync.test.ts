import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { OfflineQueue } from '../main/sync/offline-queue';
import { ConflictResolver } from '../main/sync/conflict-resolver';
import type { SyncRecord, SyncEntity } from '@jowork/core';

function makeRecord(
  id: string,
  entity: SyncEntity,
  syncVersion = 0,
  updatedAt = Date.now(),
): SyncRecord {
  return { id, entity, data: { title: `Record ${id}` }, syncVersion, updatedAt };
}

describe('OfflineQueue', () => {
  let db: Database.Database;
  let queue: OfflineQueue;

  beforeEach(() => {
    db = new Database(':memory:');
    queue = new OfflineQueue(db);
  });

  afterEach(() => {
    db.close();
  });

  it('starts empty', () => {
    expect(queue.count()).toBe(0);
  });

  it('enqueues and drains records', () => {
    queue.enqueue(makeRecord('s1', 'session'));
    queue.enqueue(makeRecord('m1', 'memory'));
    expect(queue.count()).toBe(2);

    const records = queue.drain();
    expect(records).toHaveLength(2);
    expect(records[0].id).toBe('s1');
    expect(records[1].id).toBe('m1');
  });

  it('deduplicates by entity+id', () => {
    queue.enqueue(makeRecord('s1', 'session', 0, 1000));
    queue.enqueue(makeRecord('s1', 'session', 0, 2000));
    expect(queue.count()).toBe(1);

    const records = queue.drain();
    expect(records[0].updatedAt).toBe(2000);
  });

  it('does not deduplicate different entities with same id', () => {
    queue.enqueue(makeRecord('x1', 'session'));
    queue.enqueue(makeRecord('x1', 'memory'));
    expect(queue.count()).toBe(2);
  });

  it('removes records by ID', () => {
    queue.enqueue(makeRecord('s1', 'session'));
    queue.enqueue(makeRecord('s2', 'session'));
    queue.enqueue(makeRecord('m1', 'memory'));

    queue.remove(['s1', 's2']);
    expect(queue.count()).toBe(1);

    const records = queue.drain();
    expect(records[0].id).toBe('m1');
  });

  it('remove with empty array is safe', () => {
    queue.enqueue(makeRecord('s1', 'session'));
    queue.remove([]);
    expect(queue.count()).toBe(1);
  });

  it('respects drain limit', () => {
    for (let i = 0; i < 10; i++) {
      queue.enqueue(makeRecord(`r${i}`, 'session'));
    }

    const batch = queue.drain(3);
    expect(batch).toHaveLength(3);
    // Still all 10 in queue (drain reads but doesn't remove)
    expect(queue.count()).toBe(10);
  });

  it('clears all records', () => {
    queue.enqueue(makeRecord('s1', 'session'));
    queue.enqueue(makeRecord('s2', 'session'));
    queue.clear();
    expect(queue.count()).toBe(0);
  });

  it('preserves data JSON round-trip', () => {
    const record = makeRecord('s1', 'session');
    record.data = { title: 'Test', nested: { key: 'value' }, count: 42 };
    queue.enqueue(record);

    const [drained] = queue.drain();
    expect(drained.data).toEqual({ title: 'Test', nested: { key: 'value' }, count: 42 });
  });

  it('handles deletedAt field', () => {
    const record = makeRecord('s1', 'session');
    record.deletedAt = 999;
    queue.enqueue(record);

    const [drained] = queue.drain();
    expect(drained.deletedAt).toBe(999);
  });

  it('orders by creation time (FIFO)', async () => {
    queue.enqueue(makeRecord('b', 'session'));
    // Small delay to ensure different created_at timestamps
    await new Promise((r) => setTimeout(r, 5));
    queue.enqueue(makeRecord('a', 'session'));

    const records = queue.drain();
    expect(records[0].id).toBe('b');
    expect(records[1].id).toBe('a');
  });
});

describe('ConflictResolver', () => {
  let resolver: ConflictResolver;

  beforeEach(() => {
    resolver = new ConflictResolver('personal');
  });

  it('personal mode: client wins for generic entity', () => {
    const result = resolver.resolve(
      'session',
      makeRecord('s1', 'session', 1, 1000),
      makeRecord('s1', 'session', 2, 2000),
    );
    expect(result).toBe('client_wins');
  });

  it('team mode: server wins for generic entity', () => {
    resolver.setMode('team');
    const result = resolver.resolve(
      'session',
      makeRecord('s1', 'session', 1, 2000),
      makeRecord('s1', 'session', 2, 1000),
    );
    expect(result).toBe('server_wins');
  });

  it('message entity: always server_wins (append-only)', () => {
    const result = resolver.resolve(
      'message',
      makeRecord('m1', 'message', 1, 2000),
      makeRecord('m1', 'message', 2, 1000),
    );
    expect(result).toBe('server_wins');
  });

  it('setting entity: last-writer-wins (local newer)', () => {
    const result = resolver.resolve(
      'setting',
      makeRecord('x1', 'setting', 1, 2000),
      makeRecord('x1', 'setting', 2, 1000),
    );
    expect(result).toBe('client_wins');
  });

  it('setting entity: last-writer-wins (server newer)', () => {
    const result = resolver.resolve(
      'setting',
      makeRecord('x1', 'setting', 1, 1000),
      makeRecord('x1', 'setting', 2, 2000),
    );
    expect(result).toBe('server_wins');
  });

  it('setting entity: client wins on tie', () => {
    const result = resolver.resolve(
      'setting',
      makeRecord('x1', 'setting', 1, 1000),
      makeRecord('x1', 'setting', 2, 1000),
    );
    expect(result).toBe('client_wins');
  });

  it('setMode switches resolution strategy', () => {
    // Start personal → client wins
    expect(resolver.resolve(
      'memory',
      makeRecord('m1', 'memory', 1, 1000),
      makeRecord('m1', 'memory', 2, 2000),
    )).toBe('client_wins');

    resolver.setMode('team');

    // Now team → server wins
    expect(resolver.resolve(
      'memory',
      makeRecord('m1', 'memory', 1, 1000),
      makeRecord('m1', 'memory', 2, 2000),
    )).toBe('server_wins');
  });

  it('processConflicts returns server-win IDs', () => {
    const conflicts = [
      { id: 'a', entity: 'session' as SyncEntity, localVersion: 1, serverVersion: 2, resolution: 'server_wins' as const },
      { id: 'b', entity: 'session' as SyncEntity, localVersion: 1, serverVersion: 2, resolution: 'client_wins' as const },
      { id: 'c', entity: 'memory' as SyncEntity, localVersion: 1, serverVersion: 3, resolution: 'server_wins' as const },
    ];

    const ids = resolver.processConflicts(conflicts);
    expect(ids).toEqual(['a', 'c']);
  });
});
