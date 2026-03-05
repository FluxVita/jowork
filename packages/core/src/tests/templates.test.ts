// Tests for conversation templates (migration + CRUD + API + builtins)

import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { migrate } from '../datamap/migrator.js';
import {
  createTemplate,
  listTemplates,
  getTemplate,
  updateTemplate,
  deleteTemplate,
  seedBuiltinTemplates,
} from '../templates/index.js';
import { createApp } from '../gateway/server.js';
import { templatesRouter } from '../gateway/routes/templates.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-templates-test-'));
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
  const app = createApp({ port: 0, setup(e) { e.use(templatesRouter()); } });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const close = () => new Promise<void>(resolve => server.close(() => resolve()));
  return { port, close };
}

// ─── Migration ───────────────────────────────────────────────────────────────

describe('Migration 010_conversation_templates', () => {
  afterEach(() => closeDb());

  test('creates conversation_templates table', async () => {
    const { db } = setupTestDb();
    await migrate(db);
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='conversation_templates'`).get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });

  test('table has correct columns', async () => {
    const { db } = setupTestDb();
    await migrate(db);
    const cols = db.prepare(`PRAGMA table_info(conversation_templates)`).all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    for (const col of ['id', 'name', 'description', 'system_prompt', 'first_message', 'icon', 'owner_id', 'is_builtin', 'created_at', 'updated_at']) {
      assert.ok(colNames.includes(col), `missing column: ${col}`);
    }
  });
});

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe('Template CRUD', () => {
  afterEach(() => closeDb());

  test('create and retrieve a template', async () => {
    await setupWithMigration();
    const tpl = createTemplate({ name: 'My Template', description: 'Test template', systemPrompt: 'Be helpful', ownerId: 'personal' });
    assert.ok(tpl.id);
    assert.equal(tpl.name, 'My Template');
    assert.equal(tpl.isBuiltin, false);

    const retrieved = getTemplate(tpl.id);
    assert.ok(retrieved);
    assert.equal(retrieved.name, 'My Template');
    assert.equal(retrieved.systemPrompt, 'Be helpful');
  });

  test('list templates returns user-owned templates', async () => {
    await setupWithMigration();
    createTemplate({ name: 'A', ownerId: 'personal' });
    createTemplate({ name: 'B', ownerId: 'personal' });
    createTemplate({ name: 'C', ownerId: 'other-user' });

    const list = listTemplates('personal');
    assert.equal(list.length, 2);
  });

  test('list templates includes builtins from other owners', async () => {
    await setupWithMigration();
    seedBuiltinTemplates();
    createTemplate({ name: 'Mine', ownerId: 'personal' });

    const list = listTemplates('personal');
    assert.ok(list.length >= 5); // 4 builtins + 1 custom
    assert.ok(list.some(t => t.isBuiltin));
    assert.ok(list.some(t => t.name === 'Mine'));
  });

  test('update a template', async () => {
    await setupWithMigration();
    const tpl = createTemplate({ name: 'Old Name', ownerId: 'personal' });

    const updated = updateTemplate(tpl.id, 'personal', { name: 'New Name', description: 'Updated' });
    assert.ok(updated);
    assert.equal(updated.name, 'New Name');
    assert.equal(updated.description, 'Updated');
  });

  test('cannot update another user\'s template', async () => {
    await setupWithMigration();
    const tpl = createTemplate({ name: 'Other', ownerId: 'other-user' });

    const updated = updateTemplate(tpl.id, 'personal', { name: 'Hijack' });
    assert.equal(updated, undefined);
  });

  test('cannot update builtin template', async () => {
    await setupWithMigration();
    seedBuiltinTemplates();

    const updated = updateTemplate('tpl-code-review', 'system', { name: 'Hacked' });
    assert.equal(updated, undefined);
  });

  test('delete a template', async () => {
    await setupWithMigration();
    const tpl = createTemplate({ name: 'To Delete', ownerId: 'personal' });

    const deleted = deleteTemplate(tpl.id, 'personal');
    assert.equal(deleted, true);
    assert.equal(getTemplate(tpl.id), undefined);
  });

  test('cannot delete builtin template', async () => {
    await setupWithMigration();
    seedBuiltinTemplates();

    const deleted = deleteTemplate('tpl-code-review', 'system');
    assert.equal(deleted, false);
    assert.ok(getTemplate('tpl-code-review'));
  });
});

// ─── Builtins ────────────────────────────────────────────────────────────────

describe('Builtin templates', () => {
  afterEach(() => closeDb());

  test('seedBuiltinTemplates creates 4 templates', async () => {
    await setupWithMigration();
    seedBuiltinTemplates();

    const list = listTemplates('personal');
    const builtins = list.filter(t => t.isBuiltin);
    assert.equal(builtins.length, 4);
  });

  test('seedBuiltinTemplates is idempotent', async () => {
    await setupWithMigration();
    seedBuiltinTemplates();
    seedBuiltinTemplates(); // second call

    const list = listTemplates('personal');
    const builtins = list.filter(t => t.isBuiltin);
    assert.equal(builtins.length, 4);
  });
});

// ─── API Routes ──────────────────────────────────────────────────────────────

describe('Templates API routes', () => {
  afterEach(() => closeDb());

  test('GET /api/templates returns templates', async () => {
    await setupWithMigration();
    createTemplate({ name: 'Test', ownerId: 'personal' });

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/templates`);
      assert.equal(res.status, 200);
      const body = await res.json() as unknown[];
      assert.ok(body.length >= 1);
    } finally { await close(); }
  });

  test('POST /api/templates creates a template', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New Template', description: 'Hello', systemPrompt: 'Be nice' }),
      });
      assert.equal(res.status, 201);
      const body = await res.json() as { id: string; name: string };
      assert.ok(body.id);
      assert.equal(body.name, 'New Template');
    } finally { await close(); }
  });

  test('POST /api/templates rejects missing name', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/templates`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: 'no name' }),
      });
      assert.equal(res.status, 400);
    } finally { await close(); }
  });

  test('GET /api/templates/:id returns single template', async () => {
    await setupWithMigration();
    const tpl = createTemplate({ name: 'Fetch Me', ownerId: 'personal' });

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/templates/${tpl.id}`);
      assert.equal(res.status, 200);
      const body = await res.json() as { name: string };
      assert.equal(body.name, 'Fetch Me');
    } finally { await close(); }
  });

  test('PATCH /api/templates/:id updates template', async () => {
    await setupWithMigration();
    const tpl = createTemplate({ name: 'Before', ownerId: 'personal' });

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/templates/${tpl.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'After' }),
      });
      assert.equal(res.status, 200);
      const body = await res.json() as { name: string };
      assert.equal(body.name, 'After');
    } finally { await close(); }
  });

  test('DELETE /api/templates/:id deletes template', async () => {
    await setupWithMigration();
    const tpl = createTemplate({ name: 'Gone', ownerId: 'personal' });

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/templates/${tpl.id}`, { method: 'DELETE' });
      assert.equal(res.status, 204);
    } finally { await close(); }
  });

  test('DELETE /api/templates/:id returns 404 for nonexistent', async () => {
    await setupWithMigration();
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/templates/nonexistent`, { method: 'DELETE' });
      assert.equal(res.status, 404);
    } finally { await close(); }
  });
});
