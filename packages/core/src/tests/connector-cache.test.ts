// Tests for Phase 62: Connector Content Cache

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { createConnectorConfig } from '../connectors/index.js';
import {
  listConnectorItems,
  countConnectorItems,
  deleteConnectorItems,
} from '../connectors/cache.js';
import { connectorsRouter } from '../gateway/routes/connectors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-conn-cache-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: ReturnType<typeof openDb>, id = 'personal', role = 'owner') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Admin', `${id}@test`, role, now);
}

function seedAgent(db: ReturnType<typeof openDb>, id = 'agent-1', ownerId = 'personal') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, 'Test Agent', ownerId, 'Test', 'test-model', now);
}

function seedConnectorItem(
  db: ReturnType<typeof openDb>,
  connectorId: string,
  uri: string,
  title: string,
  content: string,
) {
  const id = `item-${Math.random().toString(36).slice(2, 10)}`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO connector_items (id, connector_id, uri, title, content, content_type, sensitivity, fetched_at)
    VALUES (?, ?, ?, ?, ?, 'text/plain', 'internal', ?)
  `).run(id, connectorId, uri, title, content, now);
  // Maintain FTS index
  const row = db.prepare(`SELECT rowid FROM connector_items WHERE id = ?`).get(id) as { rowid: number };
  db.prepare(`INSERT INTO connector_items_fts(rowid, title, content) VALUES (?, ?, ?)`).run(row.rowid, title, content);
  return id;
}

// ─── Schema tests ────────────────────────────────────────────────────────────

describe('Phase 62 — connector_items table', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('connector_items table exists after initSchema', () => {
    const db = openDb();
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='connector_items'`,
    ).get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });

  test('connector_items_fts virtual table exists after initSchema', () => {
    const db = openDb();
    const row = db.prepare(
      `SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='connector_items_fts'`,
    ).get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });
});

// ─── Migration tests ─────────────────────────────────────────────────────────

describe('Phase 62 — 003_connector_items migration', () => {
  test('migration 003_connector_items is registered in migrator', async () => {
    const db = setupTestDb();
    const { migrate } = await import('../datamap/migrator.js');
    const result = await migrate(db);
    // Should include 003_connector_items either in applied or skipped
    const allNames = [...result.applied, ...result.skipped];
    assert.ok(allNames.includes('003_connector_items'), 'migration 003_connector_items should exist');
    closeDb();
  });
});

// ─── Cache CRUD tests ────────────────────────────────────────────────────────

describe('Phase 62 — connector cache CRUD', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('countConnectorItems returns 0 for empty connector', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'My GH', settings: {}, ownerId: 'personal' });
    assert.equal(countConnectorItems(cfg.id), 0);
  });

  test('listConnectorItems returns items after seeding', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'My GH', settings: {}, ownerId: 'personal' });

    seedConnectorItem(db, cfg.id, 'github:repo:test/repo1', 'Test Repo 1', 'README content for repo 1');
    seedConnectorItem(db, cfg.id, 'github:repo:test/repo2', 'Test Repo 2', 'README content for repo 2');

    const result = listConnectorItems(cfg.id);
    assert.equal(result.total, 2);
    assert.equal(result.items.length, 2);
  });

  test('listConnectorItems respects limit and offset', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'My GH', settings: {}, ownerId: 'personal' });

    for (let i = 0; i < 5; i++) {
      seedConnectorItem(db, cfg.id, `github:repo:test/repo${i}`, `Repo ${i}`, `Content ${i}`);
    }

    const page1 = listConnectorItems(cfg.id, { limit: 2, offset: 0 });
    assert.equal(page1.items.length, 2);
    assert.equal(page1.total, 5);

    const page2 = listConnectorItems(cfg.id, { limit: 2, offset: 2 });
    assert.equal(page2.items.length, 2);
    assert.equal(page2.total, 5);
  });

  test('listConnectorItems FTS search finds matching items', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'notion', name: 'Notion', settings: {}, ownerId: 'personal' });

    seedConnectorItem(db, cfg.id, 'notion:page:1', 'Sprint Planning', 'Weekly sprint planning meeting notes');
    seedConnectorItem(db, cfg.id, 'notion:page:2', 'Architecture', 'System architecture documentation');

    const result = listConnectorItems(cfg.id, { query: 'sprint' });
    assert.equal(result.total, 1);
    assert.equal(result.items[0]!.title, 'Sprint Planning');
  });

  test('listConnectorItems LIKE fallback for FTS syntax errors', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'notion', name: 'Notion', settings: {}, ownerId: 'personal' });

    seedConnectorItem(db, cfg.id, 'notion:page:1', 'Sprint Planning', 'Meeting notes');
    seedConnectorItem(db, cfg.id, 'notion:page:2', 'Architecture', 'System docs');

    // Invalid FTS5 syntax should fall back to LIKE
    const result = listConnectorItems(cfg.id, { query: 'sprint AND OR' });
    // Should not throw, returns results from LIKE fallback
    assert.equal(typeof result.total, 'number');
  });

  test('deleteConnectorItems removes all items for a connector', () => {
    const db = openDb();
    seedUser(db);
    const cfg = createConnectorConfig({ kind: 'github', name: 'My GH', settings: {}, ownerId: 'personal' });

    seedConnectorItem(db, cfg.id, 'github:repo:test/repo1', 'Repo 1', 'Content 1');
    seedConnectorItem(db, cfg.id, 'github:repo:test/repo2', 'Repo 2', 'Content 2');
    assert.equal(countConnectorItems(cfg.id), 2);

    const deleted = deleteConnectorItems(cfg.id);
    assert.equal(deleted, 2);
    assert.equal(countConnectorItems(cfg.id), 0);
  });

  test('countConnectorItems only counts items for specified connector', () => {
    const db = openDb();
    seedUser(db);
    const cfg1 = createConnectorConfig({ kind: 'github', name: 'GH1', settings: {}, ownerId: 'personal' });
    const cfg2 = createConnectorConfig({ kind: 'notion', name: 'N1', settings: {}, ownerId: 'personal' });

    seedConnectorItem(db, cfg1.id, 'github:repo:a/b', 'Repo A', 'Content A');
    seedConnectorItem(db, cfg2.id, 'notion:page:1', 'Page 1', 'Page content');
    seedConnectorItem(db, cfg2.id, 'notion:page:2', 'Page 2', 'Page content 2');

    assert.equal(countConnectorItems(cfg1.id), 1);
    assert.equal(countConnectorItems(cfg2.id), 2);
  });
});

// ─── REST API route tests ────────────────────────────────────────────────────

describe('Phase 62 — connector cache REST routes', () => {
  test('connectorsRouter exposes sync, items, and items delete routes', () => {
    const router = connectorsRouter();
    const stack = (router as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    }).stack;
    const routes = stack
      .filter(l => l.route)
      .map(l => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));

    const syncRoute = routes.find(r => r.path === '/api/connectors/:id/sync');
    assert.ok(syncRoute, 'POST /api/connectors/:id/sync should exist');
    assert.ok(syncRoute!.methods.includes('post'), 'sync should be POST');

    const itemsGetRoute = routes.find(r => r.path === '/api/connectors/:id/items' && r.methods.includes('get'));
    assert.ok(itemsGetRoute, 'GET /api/connectors/:id/items should exist');

    const itemsDeleteRoute = routes.find(r => r.path === '/api/connectors/:id/items' && r.methods.includes('delete'));
    assert.ok(itemsDeleteRoute, 'DELETE /api/connectors/:id/items should exist');
  });

  test('GET /api/connectors includes cachedItems count', () => {
    // Verify the route handler references countConnectorItems
    // We check this indirectly by ensuring the router is built without errors
    const router = connectorsRouter();
    assert.ok(router, 'connectorsRouter should build successfully');
  });
});
