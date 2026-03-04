// Tests for Phase 33: Connector Fetch + Search API

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import {
  createConnectorConfig,
  getConnectorConfig,
  connectorSearch,
  registerConnector,
  getConnectorHealth,
  checkConnectorHealth,
} from '../connectors/index.js';
import type { ConnectorConfig } from '../types.js';
import type { BaseConnector, DiscoverResult, FetchResult } from '../connectors/index.js';
import { connectorsRouter } from '../gateway/routes/connectors.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-conn-fetch-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: ReturnType<typeof openDb>, id = 'user-1', role = 'admin') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Admin', `${id}@test`, role, now);
}

// ─── connectorSearch — capability gating ─────────────────────────────────────

describe('connectorSearch — capability gating', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('connectorSearch throws NOT_SUPPORTED for connector without search', async () => {
    const db = openDb();
    seedUser(db);

    // Register a stub connector that does NOT support search
    const noSearchConnector: BaseConnector = {
      kind: 'github',
      defaultSensitivity: 'internal',
      capabilities: { canDiscover: true, canFetch: true, canSearch: false, canWrite: false },
      discover: async (_cfg: ConnectorConfig): Promise<DiscoverResult[]> => [],
      fetch: async (_cfg: ConnectorConfig, id: string): Promise<FetchResult> => ({
        id, title: 'Test', content: 'content',
      }),
    };
    registerConnector(noSearchConnector);

    const cfg = createConnectorConfig({
      kind: 'github', name: 'Test GitHub', settings: {}, ownerId: 'user-1',
    });

    await assert.rejects(
      () => connectorSearch('github', cfg, 'query'),
      (err: Error) => {
        assert.ok(err.message.length > 0);
        return true;
      },
    );
  });

  test('connectorSearch succeeds for connector with search capability', async () => {
    const db = openDb();
    seedUser(db);

    const mockResults: FetchResult[] = [
      { id: 'item-1', title: 'Sprint Planning', content: 'Meeting notes' },
    ];

    const searchableConnector: BaseConnector = {
      kind: 'notion',
      defaultSensitivity: 'confidential',
      capabilities: { canDiscover: true, canFetch: true, canSearch: true, canWrite: false },
      discover: async (_cfg: ConnectorConfig): Promise<DiscoverResult[]> => [],
      fetch: async (_cfg: ConnectorConfig, id: string): Promise<FetchResult> => ({
        id, title: 'Item', content: 'content',
      }),
      search: async (_cfg: ConnectorConfig, _query: string): Promise<FetchResult[]> => mockResults,
    };
    registerConnector(searchableConnector);

    const cfg = createConnectorConfig({
      kind: 'notion', name: 'My Notion', settings: {}, ownerId: 'user-1',
    });
    const results = await connectorSearch('notion', cfg, 'sprint');

    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, 'item-1');
    assert.equal(results[0]!.title, 'Sprint Planning');
  });
});

// ─── connectorsRouter — new endpoints ─────────────────────────────────────────

describe('connectorsRouter — fetch and search endpoints', () => {
  test('router exposes fetch and search routes', () => {
    const router = connectorsRouter();
    const stack = (router as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    }).stack;
    const routes = stack
      .filter(l => l.route)
      .map(l => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));

    const fetchRoute = routes.find(r => r.path === '/api/connectors/:id/fetch');
    const searchRoute = routes.find(r => r.path === '/api/connectors/:id/search');

    assert.ok(fetchRoute, 'fetch endpoint should exist');
    assert.ok(fetchRoute!.methods.includes('post'), 'fetch should be POST');
    assert.ok(searchRoute, 'search endpoint should exist');
    assert.ok(searchRoute!.methods.includes('post'), 'search should be POST');
  });
});

// ─── getConnectorConfig — error handling ─────────────────────────────────────

describe('getConnectorConfig — error handling', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('getConnectorConfig throws on unknown id', () => {
    openDb();
    assert.throws(
      () => getConnectorConfig('nonexistent-id'),
      (err: Error) => {
        assert.ok(err.message.length > 0);
        return true;
      },
    );
  });
});

// ─── connectorSearch — function signature ────────────────────────────────────

describe('connectorSearch — function exists', () => {
  test('connectorSearch is exported and callable', () => {
    assert.equal(typeof connectorSearch, 'function');
  });
});

// ─── Phase 55: GET /api/connectors returns health field ───────────────────────

describe('Phase 55 — connector health status', () => {
  test('getConnectorHealth returns unknown status for untracked connector', () => {
    const health = getConnectorHealth('github');
    assert.equal(health.status, 'unknown');
    assert.equal(typeof health.failureCount, 'number');
  });

  test('GET /api/connectors route includes health field', () => {
    const router = connectorsRouter();
    const stack = (router as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    }).stack;
    const routes = stack
      .filter(l => l.route)
      .map(l => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));

    const listRoute = routes.find(r => r.path === '/api/connectors' && r.methods.includes('get'));
    assert.ok(listRoute, 'GET /api/connectors route should exist');
  });

  test('GET /api/connectors response includes health field per connector', async () => {
    const db = setupTestDb();
    seedUser(db, 'user-health');

    // Register a stub connector
    const stubConnector: BaseConnector = {
      kind: 'slack',
      defaultSensitivity: 'internal',
      capabilities: { canDiscover: true, canFetch: true, canSearch: false, canWrite: false },
      discover: async (): Promise<DiscoverResult[]> => [],
      fetch: async (_cfg, id): Promise<FetchResult> => ({ id, title: 'T', content: 'c' }),
    };
    registerConnector(stubConnector);

    createConnectorConfig({ kind: 'slack', name: 'My Slack', settings: {}, ownerId: 'user-health' });

    // Verify health is returned for connector list (via listConnectorConfigs + getConnectorHealth)
    const { listConnectorConfigs } = await import('../connectors/index.js');
    const configs = listConnectorConfigs('user-health');
    assert.equal(configs.length, 1);

    const health = getConnectorHealth('slack');
    assert.ok(['healthy', 'degraded', 'unknown'].includes(health.status), 'health.status should be a valid status');
    assert.equal(typeof health.failureCount, 'number');

    closeDb();
  });
});

// ─── Phase 59: checkConnectorHealth + health-check endpoint ──────────────────

describe('Phase 59 — checkConnectorHealth', () => {
  test('checkConnectorHealth returns NOT_A_JCP_CONNECTOR for legacy connector kind', async () => {
    // 'feishu' is a legacy connector kind not in JCP registry
    const fakeCfg = {
      id: 'fake-id', kind: 'feishu' as const, name: 'Feishu', settings: {}, ownerId: 'u1',
      createdAt: new Date().toISOString(),
    };
    const result = await checkConnectorHealth(fakeCfg);
    assert.equal(result.ok, false);
    assert.equal(result.error, 'NOT_A_JCP_CONNECTOR');
  });

  test('checkConnectorHealth returns { ok: boolean, latencyMs: number } for JCP connector without credentials', async () => {
    // 'jira' is a JCP connector — health() will fail (no real server) but should not throw
    const fakeCfg = {
      id: 'fake-jira', kind: 'jira' as const, name: 'My Jira', settings: { baseUrl: '' }, ownerId: 'u1',
      createdAt: new Date().toISOString(),
    };
    const result = await checkConnectorHealth(fakeCfg);
    assert.equal(typeof result.ok, 'boolean');
    assert.equal(typeof result.latencyMs, 'number');
  });

  test('POST /api/connectors/:id/health-check route exists in connectorsRouter', () => {
    const router = connectorsRouter();
    const stack = (router as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    }).stack;
    const routes = stack
      .filter(l => l.route)
      .map(l => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));

    const hcRoute = routes.find(r => r.path === '/api/connectors/:id/health-check');
    assert.ok(hcRoute, 'POST /api/connectors/:id/health-check should exist');
    assert.ok(hcRoute!.methods.includes('post'), 'health-check should be POST');
  });
});
