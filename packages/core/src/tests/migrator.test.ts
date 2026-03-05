// Tests for Phase 14: schema migrator

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate, listMigrations } from '../datamap/migrator.js';
import { initSchema } from '../datamap/init.js';

function freshDb(): Database.Database {
  return new Database(':memory:');
}

// ─── Fresh installation ───────────────────────────────────────────────────────

describe('migrate — fresh installation', () => {
  test('applies all migrations on a brand-new DB', async () => {
    const db = freshDb();
    const result = await migrate(db);
    assert.deepEqual(result.applied, ['001_initial', '002_messages_fts', '003_connector_items', '004_connector_sync_schedule', '005_message_feedback', '006_session_pinned_folder', '007_session_forked_from', '008_model_providers', '009_audit_log', '010_conversation_templates']);
  });

  test('creates schema_migrations table', async () => {
    const db = freshDb();
    await migrate(db);
    const row = db
      .prepare(`SELECT COUNT(*) AS cnt FROM schema_migrations WHERE name = '001_initial'`)
      .get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });

  test('creates users table via migration', async () => {
    const db = freshDb();
    await migrate(db);
    const row = db
      .prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='users'`)
      .get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

describe('migrate — idempotency', () => {
  test('running twice applies nothing the second time', async () => {
    const db = freshDb();
    await migrate(db);
    const second = await migrate(db);
    assert.deepEqual(second.applied, []);
  });

  test('second run reports 001_initial as skipped', async () => {
    const db = freshDb();
    await migrate(db);
    const second = await migrate(db);
    assert.ok(second.skipped.includes('001_initial'));
  });
});

// ─── Bootstrap (existing installation) ────────────────────────────────────────

describe('migrate — bootstrap for existing DB', () => {
  test('marks 001_initial as applied if users table already exists', async () => {
    const db = freshDb();
    // Simulate existing installation that used initSchema() directly
    initSchema(db);

    const result = await migrate(db);
    // Should NOT try to apply 001_initial again (tables already exist)
    // 002_messages_fts runs (idempotent: CREATE IF NOT EXISTS + backfill empty table)
    assert.deepEqual(result.applied, ['002_messages_fts', '003_connector_items', '004_connector_sync_schedule', '005_message_feedback', '006_session_pinned_folder', '007_session_forked_from', '008_model_providers', '009_audit_log', '010_conversation_templates']);
    // 001_initial should be recorded as applied
    const row = db
      .prepare(`SELECT COUNT(*) AS cnt FROM schema_migrations WHERE name = '001_initial'`)
      .get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });
});

// ─── listMigrations ───────────────────────────────────────────────────────────

describe('listMigrations', () => {
  test('returns all defined migrations', async () => {
    const db = freshDb();
    await migrate(db);
    const list = listMigrations(db);
    assert.ok(list.length >= 1);
    const initial = list.find(m => m.name === '001_initial');
    assert.ok(initial, '001_initial should be in list');
    assert.equal(initial?.applied, true);
    assert.ok(initial?.appliedAt, 'appliedAt should be set');
  });

  test('works on empty DB (before migrate)', () => {
    const db = freshDb();
    const list = listMigrations(db);
    for (const entry of list) {
      assert.equal(entry.applied, false);
    }
  });
});
