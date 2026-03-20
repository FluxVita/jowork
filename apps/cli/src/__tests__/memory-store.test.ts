import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DbManager } from '../db/manager.js';
import { MemoryStore } from '../memory/store.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('MemoryStore', () => {
  let tempDir: string;
  let db: DbManager;
  let store: MemoryStore;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-test-'));
    db = new DbManager(join(tempDir, 'test.db'));
    db.ensureTables();
    store = new MemoryStore(db.getSqlite());
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a memory', () => {
    const mem = store.create({ title: 'Test', content: 'Hello world' });
    expect(mem.id).toMatch(/^mem_/);
    expect(mem.title).toBe('Test');
    expect(mem.content).toBe('Hello world');
    expect(mem.scope).toBe('personal');
  });

  it('lists memories', () => {
    store.create({ title: 'A', content: 'first' });
    store.create({ title: 'B', content: 'second' });
    const list = store.list();
    expect(list.length).toBe(2);
  });

  it('searches memories by title', () => {
    store.create({ title: 'About TypeScript', content: 'TS is great' });
    store.create({ title: 'About Python', content: 'Python is versatile' });
    const results = store.search('TypeScript');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('About TypeScript');
  });

  it('searches memories by content', () => {
    store.create({ title: 'A', content: 'The fox jumps over the fence' });
    store.create({ title: 'B', content: 'The cat sleeps' });
    const results = store.search('fox');
    expect(results.length).toBe(1);
    expect(results[0].title).toBe('A');
  });

  it('updates a memory', () => {
    const mem = store.create({ title: 'Original', content: 'old' });
    const updated = store.update(mem.id, { content: 'new content' });
    expect(updated?.content).toBe('new content');
    expect(updated?.title).toBe('Original');
  });

  it('deletes a memory', () => {
    const mem = store.create({ title: 'Delete me', content: 'bye' });
    store.delete(mem.id);
    expect(store.get(mem.id)).toBeNull();
  });

  it('tracks access count', () => {
    const mem = store.create({ title: 'Track', content: 'test' });
    store.touchUsed(mem.id);
    store.touchUsed(mem.id);
    const fetched = store.get(mem.id);
    expect(fetched?.accessCount).toBe(2);
  });

  it('returns null for missing memory', () => {
    expect(store.get('mem_nonexistent')).toBeNull();
  });

  it('handles tags as array', () => {
    const mem = store.create({ title: 'Tagged', content: 'x', tags: ['ts', 'node'] });
    expect(mem.tags).toEqual(['ts', 'node']);
    const fetched = store.get(mem.id);
    expect(fetched?.tags).toEqual(['ts', 'node']);
  });

  it('lists with limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      store.create({ title: `Mem ${i}`, content: `content ${i}` });
    }
    const page = store.list({ limit: 2, offset: 2 });
    expect(page.length).toBe(2);
  });
});
