// Tests for Phase 80: Custom Model Provider management (migration + CRUD + API)

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import express from 'express';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { migrate } from '../datamap/migrator.js';
import {
  createCustomProvider,
  updateCustomProvider,
  deleteCustomProvider,
  listCustomProviders,
  getCustomProvider,
  loadCustomProviders,
  getModelProvider,
  listModelProviders,
} from '../models/index.js';
import { authenticate } from '../gateway/middleware/auth.js';
import { modelsRouter } from '../gateway/routes/models.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-providers-test-'));
  const db = openDb(dir);
  initSchema(db);
  // Run migration 008_model_providers
  return { db, dir };
}

async function setupWithMigration() {
  const { db, dir } = setupTestDb();
  await migrate(db, { dataDir: dir });
  // Seed a user for auth middleware
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES ('personal', 'You', 'you@local', 'owner', ?)`).run(now);
  return { db, dir };
}

// ─── Migration ───────────────────────────────────────────────────────────────

describe('Migration 008_model_providers', () => {
  afterEach(() => closeDb());

  test('creates model_providers table', async () => {
    const { db } = setupTestDb();
    await migrate(db);
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='model_providers'`).get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });

  test('table has correct columns', async () => {
    const { db } = setupTestDb();
    await migrate(db);
    const cols = db.prepare(`PRAGMA table_info(model_providers)`).all() as Array<{ name: string }>;
    const colNames = cols.map(c => c.name);
    assert.ok(colNames.includes('id'));
    assert.ok(colNames.includes('name'));
    assert.ok(colNames.includes('api_format'));
    assert.ok(colNames.includes('endpoint'));
    assert.ok(colNames.includes('models'));
    assert.ok(colNames.includes('api_key_env'));
    assert.ok(colNames.includes('is_builtin'));
  });
});

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe('Custom Provider CRUD', () => {
  afterEach(() => closeDb());

  test('create and retrieve a custom provider', async () => {
    await setupWithMigration();
    const provider = createCustomProvider({
      id: 'azure-openai',
      name: 'Azure OpenAI',
      apiFormat: 'openai',
      endpoint: 'https://myinstance.openai.azure.com/v1',
      models: [{ id: 'gpt-4', name: 'GPT-4', contextWindow: 128000 }],
    });
    assert.equal(provider.id, 'azure-openai');
    assert.equal(provider.name, 'Azure OpenAI');

    const retrieved = getCustomProvider('azure-openai');
    assert.ok(retrieved);
    assert.equal(retrieved.name, 'Azure OpenAI');
    assert.equal(retrieved.models.length, 1);
  });

  test('list custom providers returns only non-builtin', async () => {
    await setupWithMigration();
    createCustomProvider({
      id: 'gemini',
      name: 'Google Gemini',
      apiFormat: 'openai',
      endpoint: 'https://generativelanguage.googleapis.com/v1',
    });
    const list = listCustomProviders();
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, 'gemini');
  });

  test('update custom provider', async () => {
    await setupWithMigration();
    createCustomProvider({
      id: 'custom-1',
      name: 'My Provider',
      apiFormat: 'openai',
      endpoint: 'https://example.com/v1',
    });
    const updated = updateCustomProvider('custom-1', { name: 'Updated Provider', endpoint: 'https://new.example.com/v1' });
    assert.ok(updated);
    assert.equal(updated.name, 'Updated Provider');
    assert.equal(updated.endpoint, 'https://new.example.com/v1');
  });

  test('update returns null for nonexistent provider', async () => {
    await setupWithMigration();
    const result = updateCustomProvider('nonexistent', { name: 'X' });
    assert.equal(result, null);
  });

  test('delete custom provider', async () => {
    await setupWithMigration();
    createCustomProvider({
      id: 'to-delete',
      name: 'Deletable',
      apiFormat: 'openai',
      endpoint: 'https://example.com',
    });
    const deleted = deleteCustomProvider('to-delete');
    assert.ok(deleted);
    const result = getCustomProvider('to-delete');
    assert.equal(result, null);
  });

  test('delete returns false for nonexistent', async () => {
    await setupWithMigration();
    assert.equal(deleteCustomProvider('nonexistent'), false);
  });

  test('create registers into in-memory registry', async () => {
    await setupWithMigration();
    createCustomProvider({
      id: 'test-registry',
      name: 'Registry Test',
      apiFormat: 'openai',
      endpoint: 'https://example.com/v1',
    });
    const inMemory = getModelProvider('test-registry');
    assert.ok(inMemory);
    assert.equal(inMemory.name, 'Registry Test');
  });
});

// ─── loadCustomProviders ─────────────────────────────────────────────────────

describe('loadCustomProviders', () => {
  afterEach(() => closeDb());

  test('loads saved providers into registry', async () => {
    await setupWithMigration();
    // Create a provider directly in DB
    const db = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO model_providers (id, name, api_format, endpoint, models, is_builtin, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`)
      .run('loaded-provider', 'Loaded', 'openai', 'https://loaded.example.com', '[]', now, now);

    const count = loadCustomProviders();
    assert.ok(count >= 1);
  });
});

// ─── REST API routes ─────────────────────────────────────────────────────────

describe('Models API — custom provider endpoints', () => {
  afterEach(() => closeDb());

  async function createTestApp() {
    await setupWithMigration();
    const app = express();
    app.use(express.json());
    app.use(authenticate);
    app.use(modelsRouter());
    return app;
  }

  async function startApp(app: ReturnType<typeof express>) {
    const { createServer } = await import('node:http');
    const server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    return { server, port };
  }

  test('POST /api/models/providers creates provider', async () => {
    const app = await createTestApp();
    const { server, port } = await startApp(app);

    const res = await fetch(`http://127.0.0.1:${port}/api/models/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        id: 'openrouter',
        name: 'OpenRouter',
        apiFormat: 'openai',
        endpoint: 'https://openrouter.ai/api/v1',
        models: [{ id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus via OpenRouter', contextWindow: 200000 }],
      }),
    });
    assert.equal(res.status, 201);
    const body = await res.json() as { id: string; name: string };
    assert.equal(body.id, 'openrouter');
    assert.equal(body.name, 'OpenRouter');

    server.close();
  });

  test('POST /api/models/providers rejects missing fields', async () => {
    const app = await createTestApp();
    const { server, port } = await startApp(app);

    const res = await fetch(`http://127.0.0.1:${port}/api/models/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Incomplete' }),
    });
    assert.equal(res.status, 400);

    server.close();
  });

  test('PATCH /api/models/providers/:id updates provider', async () => {
    const app = await createTestApp();
    const { server, port } = await startApp(app);

    // First create
    await fetch(`http://127.0.0.1:${port}/api/models/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'patchme', name: 'Before', apiFormat: 'openai', endpoint: 'https://example.com' }),
    });

    // Then patch
    const res = await fetch(`http://127.0.0.1:${port}/api/models/providers/patchme`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'After' }),
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { name: string };
    assert.equal(body.name, 'After');

    server.close();
  });

  test('DELETE /api/models/providers/:id deletes provider', async () => {
    const app = await createTestApp();
    const { server, port } = await startApp(app);

    // Create
    await fetch(`http://127.0.0.1:${port}/api/models/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'deleteme', name: 'Temp', apiFormat: 'openai', endpoint: 'https://example.com' }),
    });

    // Delete
    const res = await fetch(`http://127.0.0.1:${port}/api/models/providers/deleteme`, {
      method: 'DELETE',
    });
    assert.equal(res.status, 200);
    const body = await res.json() as { deleted: boolean };
    assert.ok(body.deleted);

    server.close();
  });

  test('GET /api/models/providers includes custom providers', async () => {
    const app = await createTestApp();
    const { server, port } = await startApp(app);

    // Create a custom provider
    await fetch(`http://127.0.0.1:${port}/api/models/providers`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'visible', name: 'Visible Provider', apiFormat: 'openai', endpoint: 'https://example.com' }),
    });

    const res = await fetch(`http://127.0.0.1:${port}/api/models/providers`);
    assert.equal(res.status, 200);
    const body = await res.json() as { providers: Array<{ id: string }> };
    const ids = body.providers.map(p => p.id);
    assert.ok(ids.includes('visible'), 'Custom provider should be in the list');
    // Built-in providers should also be there
    assert.ok(ids.includes('anthropic'));
    assert.ok(ids.includes('openai'));

    server.close();
  });
});
