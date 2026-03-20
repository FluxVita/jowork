import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DbManager } from '../db/manager.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('DbManager', () => {
  let tempDir: string;
  let db: DbManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-test-'));
    db = new DbManager(join(tempDir, 'test.db'));
    db.ensureTables();
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates database with WAL mode', () => {
    const mode = db.getSqlite().pragma('journal_mode', { simple: true });
    expect(mode).toBe('wal');
  });

  it('runs migrations on construction', () => {
    const tables = db.getSqlite().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('objects');
    expect(names).toContain('memories');
    expect(names).toContain('object_links');
    expect(names).toContain('schema_version');
  });

  it('tracks schema version', () => {
    const version = db.getSqlite().prepare(
      'SELECT MAX(version) as v FROM schema_version',
    ).get() as { v: number };
    expect(version.v).toBeGreaterThanOrEqual(2);
  });

  it('is idempotent — second open does not fail', () => {
    db.close();
    const db2 = new DbManager(join(tempDir, 'test.db'));
    db2.ensureTables();
    const version = db2.getSqlite().prepare(
      'SELECT MAX(version) as v FROM schema_version',
    ).get() as { v: number };
    expect(version.v).toBeGreaterThanOrEqual(2);
    db2.close();
  });

  it('sets busy_timeout', () => {
    const timeout = db.getSqlite().pragma('busy_timeout', { simple: true });
    expect(timeout).toBe(5000);
  });

  it('creates FTS virtual tables', () => {
    const tables = db.getSqlite().prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'",
    ).all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('objects_fts');
    expect(names).toContain('memories_fts');
  });

  it('enables foreign keys', () => {
    const fk = db.getSqlite().pragma('foreign_keys', { simple: true });
    expect(fk).toBe(1);
  });
});
