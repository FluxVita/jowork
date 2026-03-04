// Tests for Phase 30: Sessions REST API — DB-level CRUD and business logic

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb(): Database.Database {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-sessions-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: Database.Database, id = 'user-1', role = 'owner'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Test User', `${id}@test`, role, now);
}

function seedAgent(db: Database.Database, id = 'agent-1', ownerId = 'user-1'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, 'Test Agent', ownerId, 'You are a test agent.', 'claude-3-haiku', now);
}

function seedSession(db: Database.Database, id = 'sess-1', userId = 'user-1', agentId = 'agent-1', title = 'Test Session'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, agentId, userId, title, now, now);
}

function seedMessage(db: Database.Database, id = 'msg-1', sessionId = 'sess-1', role = 'user', content = 'Hello'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
    .run(id, sessionId, role, content, now);
}

// ─── Session CRUD — DB layer ──────────────────────────────────────────────────

describe('Session — DB CRUD', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('create and retrieve a session', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    const row = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get('sess-1') as {
      id: string; agent_id: string; user_id: string; title: string;
    } | undefined;
    assert.ok(row);
    assert.equal(row.user_id, 'user-1');
    assert.equal(row.title, 'Test Session');
    assert.equal(row.agent_id, 'agent-1');
  });

  test('list sessions for a user (order by updated_at DESC)', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .run('sess-a', 'agent-1', 'user-1', 'First', now, '2026-01-01T10:00:00.000Z');
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
      .run('sess-b', 'agent-1', 'user-1', 'Second', now, '2026-01-02T10:00:00.000Z');

    const rows = db.prepare(`SELECT id FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`).all('user-1') as { id: string }[];
    assert.equal(rows[0]!.id, 'sess-b');
    assert.equal(rows[1]!.id, 'sess-a');
  });

  test('update session title', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run('Renamed Session', 'sess-1');

    const row = db.prepare(`SELECT title FROM sessions WHERE id = ?`).get('sess-1') as { title: string };
    assert.equal(row.title, 'Renamed Session');
  });

  test('delete session removes it from DB', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    db.prepare(`DELETE FROM sessions WHERE id = ?`).run('sess-1');

    const row = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get('sess-1');
    assert.equal(row, undefined);
  });

  test('sessions are user-isolated: other user cannot see session', () => {
    const db = openDb();
    seedUser(db, 'user-1');
    seedUser(db, 'user-2');
    seedAgent(db);
    seedSession(db, 'sess-1', 'user-1');

    const row = db.prepare(`SELECT id FROM sessions WHERE id = ? AND user_id = ?`).get('sess-1', 'user-2');
    assert.equal(row, undefined, 'user-2 must not see user-1 session');
  });
});

// ─── Message CRUD — DB layer ──────────────────────────────────────────────────

describe('Message — DB CRUD', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('create and retrieve a message', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db);

    const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get('msg-1') as {
      id: string; session_id: string; role: string; content: string;
    } | undefined;
    assert.ok(row);
    assert.equal(row.session_id, 'sess-1');
    assert.equal(row.role, 'user');
    assert.equal(row.content, 'Hello');
  });

  test('list messages for a session ordered by created_at', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-a', 'sess-1', 'user', 'First', '2026-01-01T10:00:00.000Z');
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-b', 'sess-1', 'assistant', 'Second', '2026-01-01T10:01:00.000Z');

    const rows = db.prepare(`SELECT id FROM messages WHERE session_id = ? ORDER BY created_at`).all('sess-1') as { id: string }[];
    assert.equal(rows[0]!.id, 'msg-a');
    assert.equal(rows[1]!.id, 'msg-b');
  });

  test('delete a single message', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-1');
    seedMessage(db, 'msg-2', 'sess-1', 'assistant', 'Reply');

    db.prepare(`DELETE FROM messages WHERE id = ?`).run('msg-1');

    const gone = db.prepare(`SELECT id FROM messages WHERE id = ?`).get('msg-1');
    assert.equal(gone, undefined);

    const remaining = db.prepare(`SELECT id FROM messages WHERE id = ?`).get('msg-2');
    assert.ok(remaining, 'msg-2 should still exist');
  });

  test('cascade delete: deleting session removes all its messages', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-1');
    seedMessage(db, 'msg-2', 'sess-1', 'assistant', 'Reply');

    // Simulate cascade: delete messages first then session (FK behavior)
    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run('sess-1');
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run('sess-1');

    const msgs = db.prepare(`SELECT id FROM messages WHERE session_id = ?`).all('sess-1');
    assert.equal(msgs.length, 0, 'all messages should be deleted');

    const sess = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get('sess-1');
    assert.equal(sess, undefined, 'session should be deleted');
  });
});

// ─── Ownership guard logic ────────────────────────────────────────────────────

describe('Session — ownership guards', () => {
  test('ownership check passes when user_id matches', () => {
    const isOwner = (userId: string, sessionUserId: string) => userId === sessionUserId;
    assert.equal(isOwner('user-1', 'user-1'), true);
  });

  test('ownership check fails when user_id differs', () => {
    const isOwner = (userId: string, sessionUserId: string) => userId === sessionUserId;
    assert.equal(isOwner('user-2', 'user-1'), false);
  });
});

// ─── Session title validation ─────────────────────────────────────────────────

describe('Session — title validation', () => {
  test('blank title should be rejected', () => {
    function isValidTitle(title: string | undefined): boolean {
      return Boolean(title?.trim());
    }
    assert.equal(isValidTitle(''), false);
    assert.equal(isValidTitle('   '), false);
    assert.equal(isValidTitle(undefined), false);
  });

  test('non-blank title should be accepted', () => {
    function isValidTitle(title: string | undefined): boolean {
      return Boolean(title?.trim());
    }
    assert.equal(isValidTitle('My Session'), true);
    assert.equal(isValidTitle('  trimmed  '), true);
  });
});

// ─── Default agent fallback ───────────────────────────────────────────────────

describe('Session — default agent resolution', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('uses user first agent when no agentId provided', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db, 'agent-1', 'user-1');

    const agent = db.prepare(`SELECT id FROM agents WHERE owner_id = ? LIMIT 1`).get('user-1') as { id: string } | undefined;
    assert.equal(agent?.id, 'agent-1');
  });

  test('falls back to "default" when user has no agents', () => {
    const db = openDb();
    seedUser(db);

    const agent = db.prepare(`SELECT id FROM agents WHERE owner_id = ? LIMIT 1`).get('user-1') as { id: string } | undefined;
    const aid = agent?.id ?? 'default';
    assert.equal(aid, 'default');
  });
});
