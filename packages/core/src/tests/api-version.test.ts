// Tests for API versioning middleware (/api/* + /api/v1/*)

import { test, describe, afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { migrate } from '../datamap/migrator.js';
import { createApp } from '../gateway/server.js';
import { sessionsRouter, memoryRouter } from '../gateway/index.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-apiver-test-'));
  const db = openDb(dir);
  initSchema(db);
  return { db, dir };
}

async function setupWithMigration() {
  const { db, dir } = setupTestDb();
  await migrate(db, { dataDir: dir });
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES ('personal', 'You', 'you@local', 'owner', ?)`).run(now);
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, system_prompt, model, owner_id, created_at) VALUES ('agent-1', 'Test Agent', 'You are helpful', 'claude-3-haiku', 'personal', ?)`).run(now);
  return { db, dir };
}

async function makeServer() {
  const app = createApp({
    port: 0,
    setup(e) {
      e.use(sessionsRouter());
      e.use(memoryRouter());
    },
  });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const close = () => new Promise<void>(resolve => server.close(() => resolve()));
  return { port, close };
}

// ─── /api/v1/* rewriting ─────────────────────────────────────────────────────

describe('API versioning — /api/v1/* support', () => {
  afterEach(() => closeDb());

  test('/api/v1/sessions works the same as /api/sessions', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/sessions`);
      assert.equal(res.status, 200);
      const body = await res.json() as unknown[];
      assert.ok(Array.isArray(body));
      // v1 path should NOT have deprecation header
      assert.equal(res.headers.get('deprecation'), null);
    } finally { await close(); }
  });

  test('/api/v1/sessions POST creates a session', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: 'agent-1' }),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as { id: string };
      assert.ok(body.id);
    } finally { await close(); }
  });

  test('/api/v1/memories works', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/v1/memories`);
      assert.equal(res.status, 200);
    } finally { await close(); }
  });
});

// ─── Deprecation headers on /api/* ───────────────────────────────────────────

describe('API versioning — deprecation headers on /api/*', () => {
  afterEach(() => closeDb());

  test('/api/sessions returns Deprecation header', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/sessions`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('deprecation'), 'true');
      assert.equal(res.headers.get('sunset'), '2027-01-01');
      const link = res.headers.get('link');
      assert.ok(link?.includes('/api/v1/sessions'), `Link header should point to v1: ${link}`);
    } finally { await close(); }
  });

  test('/api/memories returns Deprecation header', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/memories`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('deprecation'), 'true');
    } finally { await close(); }
  });

  test('/health does NOT get deprecation header', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('deprecation'), null);
    } finally { await close(); }
  });

  test('/metrics does NOT get deprecation header', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/metrics`);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get('deprecation'), null);
    } finally { await close(); }
  });
});
