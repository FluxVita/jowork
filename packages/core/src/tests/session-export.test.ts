// Tests for Phase 60: Session Export — GET /api/sessions/:id/export?format=md|json|txt

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import http from 'node:http';
import express from 'express';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { sessionsRouter } from '../gateway/routes/sessions.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb() {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-export-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: ReturnType<typeof openDb>, id = 'personal') {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Owner', `${id}@test`, 'owner', now);
}

function seedAgent(db: ReturnType<typeof openDb>, agentId = 'agent-1', ownerId = 'personal') {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`,
  ).run(agentId, 'Test Agent', ownerId, 'You are helpful', 'claude-3-5-haiku-20241022', now);
}

function seedSession(
  db: ReturnType<typeof openDb>,
  sessionId: string,
  userId: string,
  title: string,
  agentId = 'agent-1',
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
  ).run(sessionId, agentId, userId, title, now, now);
}

function seedMessage(
  db: ReturnType<typeof openDb>,
  msgId: string,
  sessionId: string,
  role: string,
  content: string,
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`,
  ).run(msgId, sessionId, role, content, now);
}

// Minimal Express app with auth bypass (JOWORK_MODE=personal sets userId='personal')
function buildApp() {
  process.env['JOWORK_MODE'] = 'personal';
  const app = express();
  app.use(express.json());
  app.use(sessionsRouter());
  return app;
}

function request(
  app: express.Express,
  path: string,
): Promise<{ status: number; body: string; headers: Record<string, string | string[]> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, () => {
      const port = (server.address() as { port: number }).port;
      http.get(`http://localhost:${port}${path}`, (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          server.close();
          resolve({ status: res.statusCode ?? 0, body, headers: res.headers as Record<string, string | string[]> });
        });
      }).on('error', reject);
    });
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('Session Export — GET /api/sessions/:id/export', () => {
  let db: ReturnType<typeof openDb>;

  beforeEach(() => {
    db = setupTestDb();
    seedUser(db, 'personal');
    seedAgent(db, 'agent-1', 'personal');
    seedSession(db, 'sess-1', 'personal', 'My Test Session');
    seedMessage(db, 'msg-1', 'sess-1', 'user', 'Hello world');
    seedMessage(db, 'msg-2', 'sess-1', 'assistant', 'Hi there!');
  });

  afterEach(() => { closeDb(); });

  test('export as markdown (default) returns 200 with .md content', async () => {
    const app = buildApp();
    const { status, headers, body } = await request(app, '/api/sessions/sess-1/export');
    assert.equal(status, 200);
    const ct = headers['content-type'] as string;
    assert.ok(ct.includes('text/markdown'), `Expected text/markdown, got: ${ct}`);
    assert.ok(body.includes('# My Test Session'), 'Missing title heading');
    assert.ok(body.includes('Hello world'), 'Missing user message');
    assert.ok(body.includes('Hi there!'), 'Missing assistant message');
    assert.ok(body.includes('**User**'), 'Missing user speaker label');
    assert.ok(body.includes('**Assistant**'), 'Missing assistant speaker label');
  });

  test('export ?format=md returns markdown', async () => {
    const app = buildApp();
    const { status, body } = await request(app, '/api/sessions/sess-1/export?format=md');
    assert.equal(status, 200);
    assert.ok(body.startsWith('# My Test Session'));
  });

  test('export ?format=json returns valid JSON with session + messages', async () => {
    const app = buildApp();
    const { status, headers, body } = await request(app, '/api/sessions/sess-1/export?format=json');
    assert.equal(status, 200);
    const ct = headers['content-type'] as string;
    assert.ok(ct.includes('application/json'), `Expected application/json, got: ${ct}`);
    const parsed = JSON.parse(body) as { session: { title: string }; messages: { role: string; content: string }[] };
    assert.equal(parsed.session.title, 'My Test Session');
    assert.equal(parsed.messages.length, 2);
    assert.equal(parsed.messages[0]!.role, 'user');
    assert.equal(parsed.messages[0]!.content, 'Hello world');
    assert.equal(parsed.messages[1]!.role, 'assistant');
  });

  test('export ?format=txt returns plain text', async () => {
    const app = buildApp();
    const { status, headers, body } = await request(app, '/api/sessions/sess-1/export?format=txt');
    assert.equal(status, 200);
    const ct = headers['content-type'] as string;
    assert.ok(ct.includes('text/plain'), `Expected text/plain, got: ${ct}`);
    assert.ok(body.includes('Session: My Test Session'), 'Missing session title');
    assert.ok(body.includes('[User]'), 'Missing User label');
    assert.ok(body.includes('[Assistant]'), 'Missing Assistant label');
    assert.ok(body.includes('Hello world'), 'Missing user message content');
  });

  test('export unknown format falls back to markdown', async () => {
    const app = buildApp();
    const { status, headers } = await request(app, '/api/sessions/sess-1/export?format=xml');
    assert.equal(status, 200);
    const ct = headers['content-type'] as string;
    assert.ok(ct.includes('text/markdown'), `Expected markdown fallback, got: ${ct}`);
  });

  test('export non-existent session returns 404', async () => {
    const app = buildApp();
    const { status } = await request(app, '/api/sessions/no-such-session/export');
    assert.equal(status, 404);
  });

  test('export empty session (no messages) returns valid output', async () => {
    const db2 = openDb();
    seedSession(db2, 'sess-empty', 'personal', 'Empty Chat');
    // No messages seeded intentionally

    const app = buildApp();
    const { status, body } = await request(app, '/api/sessions/sess-empty/export?format=json');
    assert.equal(status, 200);
    const parsed = JSON.parse(body) as { session: { title: string }; messages: unknown[] };
    assert.equal(parsed.session.title, 'Empty Chat');
    assert.equal(parsed.messages.length, 0);
  });

  test('markdown export includes message count in header', async () => {
    const app = buildApp();
    const { body } = await request(app, '/api/sessions/sess-1/export?format=md');
    assert.ok(body.includes('Messages: 2'), `Expected "Messages: 2" in header, body: ${body.slice(0, 200)}`);
  });

  test('json export includes Content-Disposition attachment header', async () => {
    const app = buildApp();
    const { headers } = await request(app, '/api/sessions/sess-1/export?format=json');
    const cd = headers['content-disposition'] as string;
    assert.ok(cd?.includes('attachment'), `Expected attachment header, got: ${cd}`);
    assert.ok(cd?.includes('.json'), `Expected .json filename, got: ${cd}`);
  });
});
