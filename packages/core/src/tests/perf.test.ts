// Tests for Phase 12 performance utilities: Semaphore + LRU cache

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Semaphore } from '../utils/semaphore.js';
import { LRUCache } from '../utils/lru.js';

// ─── Semaphore ────────────────────────────────────────────────────────────────

describe('Semaphore', () => {
  test('allows up to N concurrent operations', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const run = async () => {
      await sem.acquire();
      active++;
      maxActive = Math.max(maxActive, active);
      // Yield to let other tasks proceed
      await new Promise(r => setImmediate(r));
      active--;
      sem.release();
    };

    await Promise.all([run(), run(), run(), run()]);
    assert.ok(maxActive <= 2, `maxActive was ${maxActive}, expected <= 2`);
  });

  test('run() releases on throw', async () => {
    const sem = new Semaphore(1);
    await assert.rejects(
      () => sem.run(() => Promise.reject(new Error('fail'))),
      { message: 'fail' },
    );
    // Slot should be released — next acquire should not deadlock
    await sem.acquire();
    sem.release();
  });

  test('rejects concurrency < 1', () => {
    assert.throws(() => new Semaphore(0), /concurrency/);
  });
});

// ─── LRU Cache ────────────────────────────────────────────────────────────────

describe('LRUCache', () => {
  test('get/set basic', () => {
    const cache = new LRUCache<string, number>(10);
    cache.set('a', 1);
    assert.equal(cache.get('a'), 1);
  });

  test('returns undefined for missing key', () => {
    const cache = new LRUCache<string, string>(10);
    assert.equal(cache.get('missing'), undefined);
  });

  test('evicts LRU when full', () => {
    const cache = new LRUCache<string, number>(3);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3);
    // Access 'a' to make it recently used
    cache.get('a');
    // Add 'd' — should evict 'b' (the LRU after 'a' was accessed)
    cache.set('d', 4);
    assert.equal(cache.get('b'), undefined, 'b should have been evicted');
    assert.equal(cache.get('a'), 1);
    assert.equal(cache.get('c'), 3);
    assert.equal(cache.get('d'), 4);
  });

  test('size stays at max', () => {
    const cache = new LRUCache<number, number>(3);
    for (let i = 0; i < 10; i++) cache.set(i, i);
    assert.equal(cache.size, 3);
  });

  test('delete removes entry', () => {
    const cache = new LRUCache<string, number>(10);
    cache.set('x', 99);
    cache.delete('x');
    assert.equal(cache.get('x'), undefined);
  });

  test('TTL expiry', async () => {
    const cache = new LRUCache<string, number>(10, 50 /* 50ms TTL */);
    cache.set('k', 42);
    assert.equal(cache.get('k'), 42);
    await new Promise(r => setTimeout(r, 60));
    assert.equal(cache.get('k'), undefined, 'should have expired');
  });

  test('rejects max < 1', () => {
    assert.throws(() => new LRUCache(0), /max/);
  });
});
