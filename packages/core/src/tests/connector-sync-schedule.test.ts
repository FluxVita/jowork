// Tests for Phase 76: Connector Auto-Sync Configuration

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { migrate } from '../datamap/migrator.js';
import {
  createConnectorConfig,
  updateConnectorConfig,
  updateSyncSchedule,
  updateLastSyncAt,
  listConnectorConfigs,
  getConnectorConfig,
} from '../connectors/index.js';
import { connectorsRouter } from '../gateway/routes/connectors.js';
import { _matchesCronForTest as matchesCron } from '../connectors/sync-scheduler.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-sync-sched-test-'));
  const db = openDb(dir);
  initSchema(db);
  migrate(db);
  return db;
}

function seedUser(db: ReturnType<typeof openDb>, id = 'personal', role = 'admin') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Admin', `${id}@test`, role, now);
}

// ─── updateConnectorConfig ──────────────────────────────────────────────────

describe('updateConnectorConfig', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('updates syncSchedule on a connector', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'My GH', settings: {}, ownerId: 'personal' });
    assert.equal(cfg.syncSchedule, undefined);

    const updated = updateConnectorConfig(cfg.id, { syncSchedule: '0 */6 * * *' });
    assert.equal(updated.syncSchedule, '0 */6 * * *');
    assert.equal(updated.name, 'My GH');
  });

  test('updates name without affecting syncSchedule', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'Old', settings: {}, ownerId: 'personal' });
    updateSyncSchedule(cfg.id, '0 0 * * *');

    const updated = updateConnectorConfig(cfg.id, { name: 'New Name' });
    assert.equal(updated.name, 'New Name');
    assert.equal(updated.syncSchedule, '0 0 * * *');
  });

  test('sets syncSchedule to null to disable auto-sync', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'GH', settings: {}, ownerId: 'personal' });
    updateSyncSchedule(cfg.id, '0 * * * *');

    const updated = updateConnectorConfig(cfg.id, { syncSchedule: null });
    assert.equal(updated.syncSchedule, undefined);
  });

  test('throws NOT_FOUND for unknown connector id', () => {
    openDb();
    assert.throws(
      () => updateConnectorConfig('nonexistent', { name: 'x' }),
      (err: Error) => err.message.includes('not found'),
    );
  });

  test('returns unchanged config when no updates provided', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'GH', settings: {}, ownerId: 'personal' });
    const same = updateConnectorConfig(cfg.id, {});
    assert.equal(same.name, 'GH');
    assert.equal(same.id, cfg.id);
  });
});

// ─── updateSyncSchedule / updateLastSyncAt ──────────────────────────────────

describe('updateSyncSchedule + updateLastSyncAt', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('updateSyncSchedule persists to DB and listConnectorConfigs returns it', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'GH', settings: {}, ownerId: 'personal' });

    updateSyncSchedule(cfg.id, '0 8 * * 1-5');
    const list = listConnectorConfigs('personal');
    assert.equal(list.length, 1);
    assert.equal(list[0]!.syncSchedule, '0 8 * * 1-5');
  });

  test('updateLastSyncAt persists to DB', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'GH', settings: {}, ownerId: 'personal' });
    const ts = '2026-03-05T10:00:00.000Z';
    updateLastSyncAt(cfg.id, ts);

    const got = getConnectorConfig(cfg.id);
    assert.equal(got.lastSyncAt, ts);
  });
});

// ─── matchesCron ─────────────────────────────────────────────────────────────

describe('matchesCron', () => {
  // matchesCron uses local time (getMinutes/getHours), so build dates in local TZ
  function localDate(min: number, hour: number, day = 5, month = 2 /* March=2 */, year = 2026): Date {
    return new Date(year, month, day, hour, min, 0, 0);
  }

  test('matches every-minute wildcard', () => {
    assert.equal(matchesCron('* * * * *', localDate(30, 12)), true);
  });

  test('matches specific minute/hour', () => {
    assert.equal(matchesCron('30 12 * * *', localDate(30, 12)), true);
    assert.equal(matchesCron('30 12 * * *', localDate(31, 12)), false);
  });

  test('matches step expressions', () => {
    // 0 */6 * * * → hour divisible by 6
    assert.equal(matchesCron('0 */6 * * *', localDate(0, 6)), true);
    assert.equal(matchesCron('0 */6 * * *', localDate(0, 7)), false);
  });

  test('rejects invalid cron (wrong field count)', () => {
    assert.equal(matchesCron('* * *', new Date()), false);
  });
});

// ─── connectorsRouter — PATCH endpoint ──────────────────────────────────────

describe('connectorsRouter — PATCH endpoint', () => {
  test('PATCH /api/connectors/:id route exists', () => {
    const router = connectorsRouter();
    const stack = (router as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    }).stack;
    const routes = stack
      .filter(l => l.route)
      .map(l => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));

    const patchRoute = routes.find(r => r.path === '/api/connectors/:id' && r.methods.includes('patch'));
    assert.ok(patchRoute, 'PATCH /api/connectors/:id should exist');
  });
});
