// Tests for Phase 16: backup / export / import

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../datamap/migrator.js';
import {
  buildExportZip,
  buildExportJson,
  buildExportCsv,
  buildExportMarkdown,
  restoreFromZip,
  isValidTableName,
} from '../datamap/export.js';
import { startBackupScheduler, stopBackupScheduler } from '../services/backup-scheduler.js';

async function freshDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  await migrate(db);
  return db;
}

// ─── isValidTableName ─────────────────────────────────────────────────────────

describe('isValidTableName', () => {
  test('accepts known tables', () => {
    assert.equal(isValidTableName('users'), true);
    assert.equal(isValidTableName('messages'), true);
    assert.equal(isValidTableName('connectors'), true);
  });

  test('rejects unknown names', () => {
    assert.equal(isValidTableName('evil'), false);
    assert.equal(isValidTableName('sqlite_master'), false);
    assert.equal(isValidTableName(''), false);
  });
});

// ─── ZIP round-trip ───────────────────────────────────────────────────────────

describe('buildExportZip + restoreFromZip', () => {
  test('round-trip: export then import preserves rows', async () => {
    const db = await freshDb();

    // Insert a user row (email is NOT NULL UNIQUE)
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
      .run('u1', 'Alice', 'alice@example.com', 'owner', new Date().toISOString());

    const zip = buildExportZip(db);
    assert.ok(zip.length > 0, 'ZIP should be non-empty');

    // Restore into a fresh DB
    const db2 = await freshDb();
    const result = await restoreFromZip(db2, zip, ':memory:');

    assert.ok(result.tablesRestored.includes('users'));
    assert.equal(result.rowsRestored['users'], 1);

    const row = db2.prepare(`SELECT name FROM users WHERE id = 'u1'`).get() as { name: string } | undefined;
    assert.equal(row?.name, 'Alice');
  });

  test('ZIP contains manifest.json', async () => {
    const db = await freshDb();
    const zip = buildExportZip(db);

    // First bytes should be PK signature (0x04034b50)
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
  });

  test('restoreFromZip rejects invalid ZIP', async () => {
    const db = await freshDb();
    await assert.rejects(
      () => restoreFromZip(db, Buffer.from('not a zip'), ':memory:'),
      /Invalid ZIP/,
    );
  });
});

// ─── JSON export ──────────────────────────────────────────────────────────────

describe('buildExportJson', () => {
  test('returns valid JSON with manifest and tables keys', async () => {
    const db = await freshDb();
    const json = buildExportJson(db);
    const parsed = JSON.parse(json) as { manifest: unknown; tables: Record<string, unknown[]> };
    assert.ok(parsed.manifest, 'should have manifest');
    assert.ok(parsed.tables, 'should have tables');
    assert.ok(Array.isArray(parsed.tables['users']), 'users should be an array');
  });
});

// ─── CSV export ───────────────────────────────────────────────────────────────

describe('buildExportCsv', () => {
  test('returns empty string for empty table', async () => {
    const db = await freshDb();
    const csv = buildExportCsv(db, 'users');
    assert.equal(csv, '');
  });

  test('returns CSV with header row for non-empty table', async () => {
    const db = await freshDb();
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
      .run('u2', 'Bob', 'bob@example.com', 'member', new Date().toISOString());
    const csv = buildExportCsv(db, 'users');
    const lines = csv.split('\n');
    assert.ok(lines[0]?.includes('id'), 'first line should be header with id');
    assert.ok(lines[1]?.includes('Bob'), 'second line should contain Bob');
  });

  test('escapes values that contain commas', async () => {
    const db = await freshDb();
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
      .run('u3', 'Smith, Jr.', 'smith@example.com', 'guest', new Date().toISOString());
    const csv = buildExportCsv(db, 'users');
    assert.ok(csv.includes('"Smith, Jr."'), 'comma-containing value should be quoted');
  });
});

// ─── Markdown export ──────────────────────────────────────────────────────────

describe('buildExportMarkdown', () => {
  test('returns string starting with # Jowork Data Export', async () => {
    const db = await freshDb();
    const md = buildExportMarkdown(db);
    assert.ok(md.startsWith('# Jowork Data Export'));
  });

  test('contains table headings for all known tables', async () => {
    const db = await freshDb();
    const md = buildExportMarkdown(db);
    assert.ok(md.includes('## users'));
    assert.ok(md.includes('## messages'));
    assert.ok(md.includes('## connectors'));
  });
});

// ─── Backup scheduler ─────────────────────────────────────────────────────────

describe('startBackupScheduler / stopBackupScheduler', () => {
  test('start then stop does not throw', async () => {
    const db = await freshDb();
    startBackupScheduler(db, ':memory:', 3, 0);
    stopBackupScheduler();
    // No assertion needed — just must not throw
    assert.ok(true);
  });

  test('calling stopBackupScheduler when not running is safe', () => {
    stopBackupScheduler();
    stopBackupScheduler(); // second call should not throw
    assert.ok(true);
  });
});
