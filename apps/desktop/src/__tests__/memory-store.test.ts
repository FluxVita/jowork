import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { MemoryStore } from '../main/memory/store';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEST_DB = join(tmpdir(), `jowork-test-memory-${Date.now()}.db`);

describe('MemoryStore', () => {
  let db: Database.Database;
  let store: MemoryStore;

  beforeEach(() => {
    db = new Database(TEST_DB);
    db.pragma('journal_mode = WAL');
    store = new MemoryStore(db);
  });

  afterEach(() => {
    db.close();
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB);
    if (existsSync(TEST_DB + '-wal')) unlinkSync(TEST_DB + '-wal');
    if (existsSync(TEST_DB + '-shm')) unlinkSync(TEST_DB + '-shm');
  });

  describe('CRUD', () => {
    it('creates a memory', () => {
      const mem = store.create({
        title: 'Test Memory',
        content: 'Some content here',
        tags: ['test', 'demo'],
      });

      expect(mem.id).toMatch(/^mem_/);
      expect(mem.title).toBe('Test Memory');
      expect(mem.content).toBe('Some content here');
      expect(mem.tags).toEqual(['test', 'demo']);
      expect(mem.scope).toBe('personal');
      expect(mem.pinned).toBe(false);
      expect(mem.source).toBe('user');
    });

    it('gets a memory by ID', () => {
      const created = store.create({ title: 'Get Test', content: 'Content' });
      const found = store.get(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe('Get Test');
    });

    it('returns null for non-existent memory', () => {
      expect(store.get('nonexistent')).toBeNull();
    });

    it('updates a memory', () => {
      const mem = store.create({ title: 'Original', content: 'Original' });
      const updated = store.update(mem.id, { title: 'Updated', pinned: true });

      expect(updated).not.toBeNull();
      expect(updated!.title).toBe('Updated');
      expect(updated!.pinned).toBe(true);
      expect(updated!.content).toBe('Original'); // unchanged
    });

    it('deletes a memory', () => {
      const mem = store.create({ title: 'Delete Me', content: 'Gone' });
      store.delete(mem.id);
      expect(store.get(mem.id)).toBeNull();
    });
  });

  describe('List & Filter', () => {
    it('lists memories in reverse chronological order', async () => {
      store.create({ title: 'First', content: 'A' });
      await new Promise((r) => setTimeout(r, 5));
      store.create({ title: 'Second', content: 'B' });
      await new Promise((r) => setTimeout(r, 5));
      store.create({ title: 'Third', content: 'C' });

      const list = store.list();
      expect(list.length).toBe(3);
      expect(list[0].title).toBe('Third');
    });

    it('filters by scope', () => {
      store.create({ title: 'Personal', content: 'P', scope: 'personal' });
      store.create({ title: 'Team', content: 'T', scope: 'team' });

      const personal = store.list({ scope: 'personal' });
      expect(personal.length).toBe(1);
      expect(personal[0].title).toBe('Personal');
    });

    it('filters by pinned', () => {
      store.create({ title: 'Pinned', content: 'P', pinned: true });
      store.create({ title: 'Not Pinned', content: 'NP' });

      const pinned = store.list({ pinned: true });
      expect(pinned.length).toBe(1);
      expect(pinned[0].title).toBe('Pinned');
    });

    it('respects limit', () => {
      for (let i = 0; i < 10; i++) {
        store.create({ title: `Mem ${i}`, content: `Content ${i}` });
      }
      const limited = store.list({ limit: 3 });
      expect(limited.length).toBe(3);
    });
  });

  describe('Search', () => {
    it('searches by title', () => {
      store.create({ title: 'React Hooks Guide', content: 'Content about hooks' });
      store.create({ title: 'TypeScript Tips', content: 'Content about TS' });

      const results = store.search('React');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('React Hooks Guide');
    });

    it('searches by content', () => {
      store.create({ title: 'Note 1', content: 'Drizzle ORM is great' });
      store.create({ title: 'Note 2', content: 'React is great' });

      const results = store.search('Drizzle');
      expect(results.length).toBe(1);
    });

    it('searches by tags', () => {
      store.create({ title: 'Tagged', content: 'Content', tags: ['important', 'urgent'] });
      store.create({ title: 'Other', content: 'Content', tags: ['low'] });

      const results = store.search('urgent');
      expect(results.length).toBe(1);
      expect(results[0].title).toBe('Tagged');
    });

    it('returns empty for no match', () => {
      store.create({ title: 'Something', content: 'Else' });
      expect(store.search('nonexistent')).toHaveLength(0);
    });
  });

  describe('Touch used', () => {
    it('updates lastUsedAt timestamp', () => {
      const mem = store.create({ title: 'Touch', content: 'Me' });
      expect(mem.lastUsedAt).toBeNull();

      store.touchUsed(mem.id);
      const updated = store.get(mem.id);
      expect(updated!.lastUsedAt).toBeGreaterThan(0);
    });
  });

  describe('Tags serialization', () => {
    it('handles empty tags', () => {
      const mem = store.create({ title: 'No Tags', content: 'Test' });
      expect(mem.tags).toEqual([]);
    });

    it('roundtrips tags correctly', () => {
      const mem = store.create({
        title: 'With Tags',
        content: 'Test',
        tags: ['a', 'b', 'c'],
      });
      const found = store.get(mem.id);
      expect(found!.tags).toEqual(['a', 'b', 'c']);
    });
  });
});
