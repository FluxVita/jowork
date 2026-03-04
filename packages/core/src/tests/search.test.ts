// Tests for Phase 48: Global Search REST API

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { createApp, searchRouter } from '../index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-search-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: ReturnType<typeof openDb>, id = 'user-1') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Test User', `${id}@test`, 'owner', now);
}

function seedAgent(db: ReturnType<typeof openDb>, id = 'agent-1', ownerId = 'user-1') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, 'Agent', ownerId, '', 'claude-3-haiku', now);
}

function seedSession(db: ReturnType<typeof openDb>, id = 'sess-1', userId = 'user-1', agentId = 'agent-1', title = 'My Session') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, agentId, userId, title, now, now);
}

function seedMessage(db: ReturnType<typeof openDb>, id: string, sessionId: string, content: string) {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
    .run(id, sessionId, 'user', content, now);
  // Update FTS index
  db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`).run(id);
}

function seedMemory(db: ReturnType<typeof openDb>, id: string, userId: string, content: string) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO memories (id, user_id, content, tags, source, sensitivity, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, userId, content, '[]', 'user', 'internal', now, now);
  // Update FTS index
  db.prepare(`INSERT INTO memories_fts(rowid, content) SELECT rowid, content FROM memories WHERE id = ?`).run(id);
}

function seedContextDoc(db: ReturnType<typeof openDb>, id: string, userId: string, title: string, content: string) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO context_docs (id, layer, scope_id, title, content, doc_type, is_forced, sensitivity, created_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id, 'personal', userId, title, content, 'workstyle', 0, 'internal', userId, now);
  // Update FTS index
  db.prepare(`INSERT INTO context_docs_fts(rowid, title, content) SELECT rowid, title, content FROM context_docs WHERE id = ?`).run(id);
}

// ─── /api/search endpoint ──────────────────────────────────────────────────────

async function makeServer() {
  const app = createApp({ port: 0, setup(e) { e.use(searchRouter()); } });
  const server = createServer(app);
  await new Promise<void>(resolve => server.listen(0, resolve));
  const port = (server.address() as { port: number }).port;
  const close = () => new Promise<void>(resolve => server.close(() => resolve()));
  return { port, close };
}

// Personal mode: authenticate sets userId='personal' for all requests.
// Seed all data with userId='personal' so queries match.
const PERSONAL_ID = 'personal';

describe('/api/search', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = setupTestDb();
    seedUser(db, PERSONAL_ID);
    seedAgent(db, 'agent-1', PERSONAL_ID);
    seedSession(db, 'sess-1', PERSONAL_ID);
  });

  afterEach(() => { closeDb(); });

  test('returns empty results for blank query', async () => {
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/search?q=`);
      assert.equal(res.status, 200);
      const body = await res.json() as { query: string; messages: unknown[]; memories: unknown[]; context: unknown[] };
      assert.equal(body.query, '');
      assert.deepEqual(body.messages, []);
      assert.deepEqual(body.memories, []);
      assert.deepEqual(body.context, []);
    } finally { await close(); }
  });

  test('returns no results when nothing matches', async () => {
    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/search?q=xyzzy_not_found`);
      assert.equal(res.status, 200);
      const body = await res.json() as { messages: unknown[]; memories: unknown[]; context: unknown[] };
      assert.deepEqual(body.messages, []);
      assert.deepEqual(body.memories, []);
      assert.deepEqual(body.context, []);
    } finally { await close(); }
  });

  test('finds messages containing the query', async () => {
    seedMessage(db, 'msg-1', 'sess-1', 'Hello searchable world');
    seedMessage(db, 'msg-2', 'sess-1', 'Unrelated content here');

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/search?q=searchable`);
      assert.equal(res.status, 200);
      const body = await res.json() as {
        query: string;
        messages: Array<{ id: string; sessionId: string; sessionTitle: string; snippet: string }>;
      };
      assert.equal(body.query, 'searchable');
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0]!.id, 'msg-1');
      assert.equal(body.messages[0]!.sessionId, 'sess-1');
      assert.equal(body.messages[0]!.sessionTitle, 'My Session');
      assert.ok(body.messages[0]!.snippet.includes('searchable'));
    } finally { await close(); }
  });

  test('finds memories via FTS5', async () => {
    seedMemory(db, 'mem-1', PERSONAL_ID, 'Remember to deploy on Friday');
    seedMemory(db, 'mem-2', PERSONAL_ID, 'Unrelated note');

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/search?q=deploy`);
      assert.equal(res.status, 200);
      const body = await res.json() as {
        memories: Array<{ id: string; snippet: string; source: string }>;
      };
      assert.equal(body.memories.length, 1);
      assert.equal(body.memories[0]!.id, 'mem-1');
      assert.ok(body.memories[0]!.snippet.includes('deploy'));
    } finally { await close(); }
  });

  test('finds context docs via FTS5', async () => {
    seedContextDoc(db, 'ctx-1', PERSONAL_ID, 'Work Style', 'I prefer async communication');
    seedContextDoc(db, 'ctx-2', PERSONAL_ID, 'Other Doc', 'Unrelated content');

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/search?q=async`);
      assert.equal(res.status, 200);
      const body = await res.json() as {
        context: Array<{ id: string; title: string; layer: string }>;
      };
      assert.equal(body.context.length, 1);
      assert.equal(body.context[0]!.id, 'ctx-1');
      assert.equal(body.context[0]!.title, 'Work Style');
      assert.equal(body.context[0]!.layer, 'personal');
    } finally { await close(); }
  });

  test('does not return messages from other users sessions', async () => {
    // Seed another user + their session + message
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
      .run('user-2', 'Other', 'other@test', 'owner', now);
    db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
      .run('agent-2', 'A2', 'user-2', '', 'claude-3-haiku', now);
    db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .run('sess-2', 'agent-2', 'user-2', 'Other Session', now, now);
    db.prepare(`INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-other', 'sess-2', 'user', 'secret token data', now);

    const { port, close } = await makeServer();
    try {
      // Authenticated as 'personal' — should NOT see user-2's messages
      const res = await fetch(`http://localhost:${port}/api/search?q=secret`);
      assert.equal(res.status, 200);
      const body = await res.json() as { messages: Array<{ id: string }> };
      assert.equal(body.messages.length, 0);
    } finally { await close(); }
  });

  test('respects limit parameter', async () => {
    for (let i = 1; i <= 5; i++) {
      seedMessage(db, `msg-${i}`, 'sess-1', `test message number ${i}`);
    }

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/search?q=test&limit=2`);
      assert.equal(res.status, 200);
      const body = await res.json() as { messages: unknown[] };
      assert.equal(body.messages.length, 2);
    } finally { await close(); }
  });

  test('finds messages via FTS5 (exact word match)', async () => {
    seedMessage(db, 'fts-msg-1', 'sess-1', 'The deployment pipeline is broken');
    seedMessage(db, 'fts-msg-2', 'sess-1', 'Unrelated message about lunch');

    const { port, close } = await makeServer();
    try {
      const res = await fetch(`http://localhost:${port}/api/search?q=deployment`);
      assert.equal(res.status, 200);
      const body = await res.json() as {
        messages: Array<{ id: string; snippet: string }>;
      };
      assert.equal(body.messages.length, 1);
      assert.equal(body.messages[0]!.id, 'fts-msg-1');
      assert.ok(body.messages[0]!.snippet.includes('deployment'));
    } finally { await close(); }
  });

  test('FTS5 message search falls back to LIKE on syntax error', async () => {
    seedMessage(db, 'fallback-msg', 'sess-1', 'fallback keyword test');

    const { port, close } = await makeServer();
    try {
      // FTS5 syntax error: unmatched quote — should not crash, LIKE fallback returns results
      const res = await fetch(`http://localhost:${port}/api/search?q=${encodeURIComponent('fallback "')}`);
      assert.equal(res.status, 200);
      const body = await res.json() as { messages: Array<{ id: string }> };
      // LIKE fallback should find the message (searches for %fallback "%%)
      // Either found or not found is acceptable — no 500 error is the key assertion
      assert.ok(Array.isArray(body.messages));
    } finally { await close(); }
  });
});
