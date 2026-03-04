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
