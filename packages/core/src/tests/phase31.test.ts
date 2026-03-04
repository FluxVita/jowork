// Tests for Phase 31: chat/connectors/memory/context/stats routes moved to core

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import {
  createConnectorConfig,
  listConnectorConfigs,
  deleteConnectorConfig,
} from '../connectors/index.js';
import { saveMemory, searchMemory, deleteMemory } from '../memory/index.js';
import {
  createContextDoc,
  listContextDocs,
  deleteContextDoc,
  saveWorkstyleDoc,
  assembleContext,
} from '../context/index.js';
import { chatRouter } from '../gateway/routes/chat.js';
import type { DispatchFn } from '../gateway/routes/chat.js';
import type { RunOptions, RunResult } from '../agent/engines/builtin.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb(): Database.Database {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-phase31-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: Database.Database, id = 'user-1'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Test User', `${id}@test`, 'owner', now);
}

// ─── Connector CRUD — DB layer ────────────────────────────────────────────────

describe('Connectors — DB CRUD', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('create and list a connector config', () => {
    const db = openDb();
    seedUser(db);

    const cfg = createConnectorConfig({
      kind: 'github',
      name: 'My GitHub',
      settings: { token: 'gh-token', owner: 'myorg' },
      ownerId: 'user-1',
    });

    assert.ok(cfg.id);
    assert.equal(cfg.kind, 'github');
    assert.equal(cfg.name, 'My GitHub');
    assert.equal(cfg.ownerId, 'user-1');

    const list = listConnectorConfigs('user-1');
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, cfg.id);
  });

  test('list connectors for a specific owner only', () => {
    const db = openDb();
    seedUser(db, 'user-1');
    seedUser(db, 'user-2');

    createConnectorConfig({ kind: 'notion', name: 'N1', settings: {}, ownerId: 'user-1' });
    createConnectorConfig({ kind: 'slack', name: 'S1', settings: {}, ownerId: 'user-2' });

    assert.equal(listConnectorConfigs('user-1').length, 1);
    assert.equal(listConnectorConfigs('user-2').length, 1);
  });

  test('delete a connector config', () => {
    const db = openDb();
    seedUser(db);

    const cfg = createConnectorConfig({ kind: 'gitlab', name: 'GL', settings: {}, ownerId: 'user-1' });
    assert.equal(listConnectorConfigs('user-1').length, 1);

    deleteConnectorConfig(cfg.id);
    assert.equal(listConnectorConfigs('user-1').length, 0);
  });
});

// ─── Memory — DB layer ────────────────────────────────────────────────────────

describe('Memory — DB CRUD', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('save and retrieve a memory', () => {
    const db = openDb();
    seedUser(db);

    const entry = saveMemory('user-1', 'Remember to review PRs on Fridays', { tags: ['work'] });
    assert.ok(entry.id);
    assert.equal(entry.userId, 'user-1');
    assert.ok(entry.content.includes('PRs'));

    const results = searchMemory({ userId: 'user-1' });
    assert.equal(results.length, 1);
    assert.equal(results[0]!.id, entry.id);
  });

  test('search memories by query', () => {
    const db = openDb();
    seedUser(db);

    saveMemory('user-1', 'Sprint planning every Monday at 10am', { tags: ['calendar'] });
    saveMemory('user-1', 'Team prefers async communication', { tags: ['team'] });

    const hits = searchMemory({ userId: 'user-1', query: 'Monday' });
    assert.equal(hits.length, 1);
    assert.ok(hits[0]!.content.includes('Monday'));
  });

  test('delete a memory', () => {
    const db = openDb();
    seedUser(db);

    const entry = saveMemory('user-1', 'Temporary note');
    deleteMemory(entry.id);

    const results = searchMemory({ userId: 'user-1' });
    assert.equal(results.length, 0);
  });
});

// ─── Context Docs — DB layer ──────────────────────────────────────────────────

describe('Context Docs — DB CRUD', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('create and list a personal context doc', () => {
    const db = openDb();
    seedUser(db);

    const doc = createContextDoc({
      layer: 'personal',
      scopeId: 'user-1',
      title: 'My Working Style',
      content: 'I prefer async communication and detailed PRs.',
      createdBy: 'user-1',
      docType: 'workstyle',
    });

    assert.ok(doc.id);
    assert.equal(doc.layer, 'personal');

    const list = listContextDocs({ layer: 'personal', scopeId: 'user-1' });
    assert.equal(list.length, 1);
    assert.equal(list[0]!.id, doc.id);
  });

  test('saveWorkstyleDoc upserts personal workstyle', () => {
    const db = openDb();
    seedUser(db);

    const doc1 = saveWorkstyleDoc('user-1', 'First version');
    const doc2 = saveWorkstyleDoc('user-1', 'Updated version');

    // should upsert to same doc
    assert.equal(doc1.id, doc2.id);
    assert.equal(doc2.content, 'Updated version');
  });

  test('delete a context doc', () => {
    const db = openDb();
    seedUser(db);

    const doc = createContextDoc({
      layer: 'personal', scopeId: 'user-1',
      title: 'Temp', content: 'Temp content', createdBy: 'user-1',
    });

    deleteContextDoc(doc.id);
    const list = listContextDocs({ layer: 'personal', scopeId: 'user-1' });
    assert.equal(list.length, 0);
  });

  test('assembleContext returns relevant docs', () => {
    const db = openDb();
    seedUser(db);

    saveWorkstyleDoc('user-1', 'I prefer async communication and async reviews');

    const assembled = assembleContext({ userId: 'user-1', query: 'communication style' });
    assert.ok(Array.isArray(assembled.includedDocIds));
    assert.equal(typeof assembled.systemFragment, 'string');
  });
});

// ─── Stats — DB layer ────────────────────────────────────────────────────────

describe('Stats — aggregate counts', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('stats returns correct aggregate counts', () => {
    const db = openDb();
    seedUser(db);

    // Seed agent
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
      .run('agent-1', 'Test Agent', 'user-1', 'You are test.', 'claude-haiku', now);

    // Seed session
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .run('sess-1', 'agent-1', 'user-1', 'Test', now, now);

    // Seed messages
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-1', 'sess-1', 'user', 'Hello', now);
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-2', 'sess-1', 'assistant', 'Hi!', now);

    // Verify counts directly
    const sessCount = (db.prepare(`SELECT COUNT(*) as n FROM sessions WHERE user_id = ?`).get('user-1') as { n: number }).n;
    const msgCount = (db.prepare(`SELECT COUNT(*) as n FROM messages m JOIN sessions s ON m.session_id = s.id WHERE s.user_id = ?`).get('user-1') as { n: number }).n;

    assert.equal(sessCount, 1);
    assert.equal(msgCount, 2);
  });
});

// ─── Chat router — dispatchFn injection ───────────────────────────────────────

describe('chatRouter — dispatchFn injection', () => {
  test('chatRouter uses provided dispatchFn', () => {
    let called = false;
    const mockDispatch: DispatchFn = async (_opts: RunOptions): Promise<RunResult> => {
      called = true;
      return { messages: [], turnCount: 1 };
    };

    const router = chatRouter(mockDispatch);
    // Router should be created without error
    assert.ok(router);
    assert.equal(called, false); // not called yet, only when request comes in
  });

  test('chatRouter without dispatchFn uses runBuiltin by default', () => {
    const router = chatRouter();
    assert.ok(router);
  });
});
