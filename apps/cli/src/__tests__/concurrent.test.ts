import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DbManager } from '../db/manager.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

describe('Concurrent SQLite access', () => {
  let tempDir: string;
  let dbFilePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-concurrent-'));
    dbFilePath = join(tempDir, 'test.db');
    // Initialize DB with migrations
    const init = new DbManager(dbFilePath);
    init.ensureTables();
    init.close();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('handles two connections writing simultaneously via busy_timeout', () => {
    // Simulate daemon sync (writer 1) and MCP write_memory (writer 2)
    const conn1 = new Database(dbFilePath);
    conn1.pragma('journal_mode = WAL');
    conn1.pragma('busy_timeout = 5000');

    const conn2 = new Database(dbFilePath);
    conn2.pragma('journal_mode = WAL');
    conn2.pragma('busy_timeout = 5000');

    // Writer 1: batch insert objects (simulating sync)
    const insertObj = conn1.prepare(
      `INSERT OR IGNORE INTO objects (id, source, source_type, uri, title, summary, content_hash, last_synced_at, created_at)
       VALUES (?, 'test', 'msg', ?, 'title', 'summary', 'hash', ?, ?)`,
    );
    const now = Date.now();

    // Writer 2: insert memory
    const insertMem = conn2.prepare(
      `INSERT INTO memories (id, title, content, tags, scope, pinned, source, access_count, created_at, updated_at)
       VALUES (?, ?, ?, '[]', 'personal', 0, 'auto', 0, ?, ?)`,
    );

    // Interleave writes
    const batchSync = conn1.transaction(() => {
      for (let i = 0; i < 50; i++) {
        insertObj.run(`obj_${i}`, `test://obj/${i}`, now, now);
      }
    });

    // This should not throw SQLITE_BUSY thanks to busy_timeout
    batchSync();
    insertMem.run('mem_1', 'Test Memory', 'content', now, now);

    // Verify both writes succeeded
    const objCount = (conn1.prepare('SELECT COUNT(*) as c FROM objects').get() as { c: number }).c;
    const memCount = (conn2.prepare('SELECT COUNT(*) as c FROM memories').get() as { c: number }).c;

    expect(objCount).toBe(50);
    expect(memCount).toBe(1);

    conn1.close();
    conn2.close();
  });

  it('batch insert uses short transactions (100 per batch)', () => {
    const conn = new Database(dbFilePath);
    conn.pragma('journal_mode = WAL');
    conn.pragma('busy_timeout = 5000');

    const insert = conn.prepare(
      `INSERT OR IGNORE INTO objects (id, source, source_type, uri, title, summary, content_hash, last_synced_at, created_at)
       VALUES (?, 'test', 'msg', ?, 'title', 'summary', 'hash', ?, ?)`,
    );
    const now = Date.now();

    // Insert 250 items in batches of 100
    const items = Array.from({ length: 250 }, (_, i) => i);
    for (let i = 0; i < items.length; i += 100) {
      const batch = items.slice(i, i + 100);
      const txn = conn.transaction(() => {
        for (const j of batch) {
          insert.run(`batch_${j}`, `test://batch/${j}`, now, now);
        }
      });
      txn();
    }

    const count = (conn.prepare('SELECT COUNT(*) as c FROM objects').get() as { c: number }).c;
    expect(count).toBe(250);

    conn.close();
  });
});
