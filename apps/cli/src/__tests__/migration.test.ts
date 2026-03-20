import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { DbManager } from '../db/manager.js';

describe('Migration failure handling', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-migration-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('rolls back failed migration without corrupting database', () => {
    const dbFile = join(tempDir, 'test.db');
    const sqlite = new Database(dbFile);
    sqlite.pragma('journal_mode = WAL');

    // Create schema_version table manually
    sqlite.exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)`);
    sqlite.exec(`INSERT INTO schema_version (version) VALUES (0)`);

    // Create a valid table first
    sqlite.exec(`CREATE TABLE test_table (id TEXT PRIMARY KEY)`);
    sqlite.exec(`INSERT INTO test_table VALUES ('existing_data')`);

    // Simulate a migration that fails mid-way
    try {
      sqlite.transaction(() => {
        sqlite.exec(`CREATE TABLE new_table (id TEXT PRIMARY KEY)`);
        sqlite.exec(`INSERT INTO new_table VALUES ('new_data')`);
        // This should fail -- invalid SQL
        sqlite.exec(`INVALID SQL STATEMENT HERE`);
      })();
    } catch {
      // Expected -- migration should have been rolled back
    }

    // Verify: new_table should NOT exist (rolled back)
    const tables = sqlite.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='new_table'",
    ).all();
    expect(tables.length).toBe(0);

    // Verify: existing data is intact
    const existing = sqlite.prepare('SELECT id FROM test_table').get() as { id: string };
    expect(existing.id).toBe('existing_data');

    sqlite.close();
  });

  it('does not re-apply already applied migrations', () => {
    const dbFile = join(tempDir, 'test.db');

    // First open -- applies all migrations
    const db1 = new DbManager(dbFile);
    db1.ensureTables();
    const version1 = (db1.getSqlite().prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
    db1.close();

    // Second open -- should not re-apply
    const db2 = new DbManager(dbFile);
    db2.ensureTables();
    const version2 = (db2.getSqlite().prepare('SELECT MAX(version) as v FROM schema_version').get() as { v: number }).v;
    expect(version2).toBe(version1);

    // Count how many times version 1 appears (should be exactly once)
    const count = (db2.getSqlite().prepare('SELECT COUNT(*) as c FROM schema_version WHERE version = 1').get() as { c: number }).c;
    expect(count).toBe(1);

    db2.close();
  });
});
