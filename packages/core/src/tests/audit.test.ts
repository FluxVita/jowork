// Tests for audit logging (migration + CRUD + middleware + API routes)

import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

import { openDb, closeDb, getDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { migrate } from '../datamap/migrator.js';
import {
  recordAudit,
  queryAuditLog,
  purgeAuditBefore,
  inferResourceType,
} from '../audit/index.js';
import { auditRouter } from '../gateway/routes/audit.js';
import { createApp } from '../gateway/server.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-audit-test-'));
  const db = openDb(dir);
  initSchema(db);
  return { db, dir };
}

async function setupWithMigration() {
  const { db, dir } = setupTestDb();
  await migrate(db, { dataDir: dir });
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES ('personal', 'You', 'you@local', 'owner', ?)`).run(now);
  return { db, dir };
}

async function makeServer() {
  const app = createApp({ port: 0, setup(e) { e.use(auditRouter()); } });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const close = () => new Promise<void>(resolve => server.close(() => resolve()));
  return { port, close };
}

// ─── Migration ───────────────────────────────────────────────────────────────

describe('Migration 009_audit_log', () => {
  afterEach(() => closeDb());

  test('creates audit_log table', async () => {
    const { db } = setupTestDb();
    await migrate(db);
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='audit_log'`).get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });

  test('audit_log table has correct columns', async () => {
    const { db } = setupTestDb();
    await migrate(db);
    const cols = db.prepare(`PRAGMA table_info(audit_log)`).all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    for (const col of ['id', 'user_id', 'action', 'resource', 'resource_type', 'status_code', 'ip', 'user_agent', 'created_at']) {
      assert.ok(colNames.includes(col), `missing column: ${col}`);
    }
  });
});

// ─── recordAudit + queryAuditLog ─────────────────────────────────────────────

describe('Audit CRUD', () => {
  afterEach(() => closeDb());

  test('record and query a single audit entry', async () => {
    await setupWithMigration();
    const entry = recordAudit({
      userId: 'personal',
      action: 'POST',
      resource: '/api/sessions',
      resourceType: 'sessions',
      statusCode: 201,
      ip: '127.0.0.1',
      userAgent: 'test-agent',
    });
    assert.ok(entry.id);
    assert.equal(entry.userId, 'personal');
    assert.equal(entry.action, 'POST');

    const result = queryAuditLog();
    assert.equal(result.total, 1);
    assert.equal(result.entries[0]!.resource, '/api/sessions');
  });

  test('query with userId filter', async () => {
    await setupWithMigration();
    recordAudit({ userId: 'personal', action: 'POST', resource: '/api/sessions', resourceType: 'sessions', statusCode: 201 });
    recordAudit({ userId: 'other', action: 'DELETE', resource: '/api/sessions/abc', resourceType: 'sessions', statusCode: 200 });

    const result = queryAuditLog({ userId: 'personal' });
    assert.equal(result.total, 1);
    assert.equal(result.entries[0]!.userId, 'personal');
  });

  test('query with action filter', async () => {
    await setupWithMigration();
    recordAudit({ userId: 'personal', action: 'POST', resource: '/api/sessions', resourceType: 'sessions', statusCode: 201 });
    recordAudit({ userId: 'personal', action: 'DELETE', resource: '/api/sessions/abc', resourceType: 'sessions', statusCode: 200 });

    const result = queryAuditLog({ action: 'DELETE' });
    assert.equal(result.total, 1);
    assert.equal(result.entries[0]!.action, 'DELETE');
  });

  test('query with limit and offset', async () => {
    await setupWithMigration();
    for (let i = 0; i < 5; i++) {
      recordAudit({ userId: 'personal', action: 'POST', resource: `/api/sessions/${i}`, resourceType: 'sessions', statusCode: 201 });
    }

    const page1 = queryAuditLog({ limit: 2 });
    assert.equal(page1.total, 5);
    assert.equal(page1.entries.length, 2);

    const page2 = queryAuditLog({ limit: 2, offset: 2 });
    assert.equal(page2.entries.length, 2);
  });

  test('purge removes old entries', async () => {
    await setupWithMigration();
    recordAudit({ userId: 'personal', action: 'POST', resource: '/api/sessions', resourceType: 'sessions', statusCode: 201 });

    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const deleted = purgeAuditBefore(tomorrow);
    assert.equal(deleted, 1);

    const result = queryAuditLog();
    assert.equal(result.total, 0);
  });

  test('query with date range filter', async () => {
    await setupWithMigration();
    recordAudit({ userId: 'personal', action: 'POST', resource: '/api/sessions', resourceType: 'sessions', statusCode: 201 });

    const result = queryAuditLog({ since: '2020-01-01T00:00:00.000Z', until: '2099-01-01T00:00:00.000Z' });
    assert.equal(result.total, 1);

    const noResult = queryAuditLog({ since: '2099-01-01T00:00:00.000Z' });
    assert.equal(noResult.total, 0);
  });
});

// ─── inferResourceType ───────────────────────────────────────────────────────

describe('inferResourceType', () => {
  test('extracts resource type from API path', () => {
    assert.equal(inferResourceType('/api/sessions/abc'), 'sessions');
    assert.equal(inferResourceType('/api/connectors'), 'connectors');
    assert.equal(inferResourceType('/api/memories/123'), 'memories');
    assert.equal(inferResourceType('/api/admin/backup'), 'admin');
  });

  test('returns unknown for non-API paths', () => {
    assert.equal(inferResourceType('/health'), 'unknown');
    assert.equal(inferResourceType('/'), 'unknown');
  });
});

// ─── API Routes ──────────────────────────────────────────────────────────────

describe('Audit API routes', () => {
  afterEach(() => closeDb());

  test('GET /api/audit returns audit entries', async () => {
    await setupWithMigration();
    recordAudit({ userId: 'personal', action: 'POST', resource: '/api/sessions', resourceType: 'sessions', statusCode: 201 });

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/audit`);
      assert.equal(res.status, 200);
      const body = await res.json() as { entries: unknown[]; total: number };
      assert.equal(body.total, 1);
      assert.equal(body.entries.length, 1);
    } finally { await close(); }
  });

  test('GET /api/audit supports query filters', async () => {
    await setupWithMigration();
    recordAudit({ userId: 'personal', action: 'POST', resource: '/api/sessions', resourceType: 'sessions', statusCode: 201 });
    recordAudit({ userId: 'personal', action: 'DELETE', resource: '/api/connectors/abc', resourceType: 'connectors', statusCode: 200 });

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/audit?resourceType=connectors`);
      assert.equal(res.status, 200);
      const body = await res.json() as { entries: unknown[]; total: number };
      assert.equal(body.total, 1);
    } finally { await close(); }
  });

  test('DELETE /api/audit/purge requires before param', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/audit/purge`, { method: 'DELETE' });
      assert.equal(res.status, 400);
    } finally { await close(); }
  });

  test('DELETE /api/audit/purge removes old entries', async () => {
    await setupWithMigration();
    recordAudit({ userId: 'personal', action: 'POST', resource: '/api/sessions', resourceType: 'sessions', statusCode: 201 });

    const { port, close } = await makeServer();
    try {
      const tomorrow = new Date(Date.now() + 86400000).toISOString();
      const res = await fetch(`http://localhost:${port}/api/audit/purge?before=${encodeURIComponent(tomorrow)}`, { method: 'DELETE' });
      assert.equal(res.status, 200);
      const body = await res.json() as { deleted: number };
      assert.equal(body.deleted, 1);
    } finally { await close(); }
  });
});
