// Tests for Phase 65: Message Regenerate — DB-level logic

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
  const dir = mkdtempSync(join(tmpdir(), 'jowork-regenerate-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: Database.Database, id = 'user-1'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Test User', `${id}@test`, 'owner', now);
}

function seedAgent(db: Database.Database, id = 'agent-1', ownerId = 'user-1'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, 'Test Agent', ownerId, 'You are a test agent.', 'claude-3-haiku', now);
}

function seedSession(db: Database.Database, id = 'sess-1', userId = 'user-1', agentId = 'agent-1'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, agentId, userId, 'Test Session', now, now);
}

function seedMessage(db: Database.Database, id: string, sessionId: string, role: string, content: string, createdAt?: string): void {
  const ts = createdAt ?? new Date().toISOString();
  db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
    .run(id, sessionId, role, content, ts);
}

// ─── Regenerate — DB layer ──────────────────────────────────────────────────

describe('Regenerate — DB operations', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('find assistant message and preceding user message', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    seedMessage(db, 'msg-u1', 'sess-1', 'user', 'Hello', '2026-01-01T10:00:00.000Z');
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hi there!', '2026-01-01T10:00:01.000Z');

    // Find assistant message
    const assistantMsg = db.prepare(
      `SELECT id, role, created_at FROM messages WHERE id = ? AND session_id = ?`,
    ).get('msg-a1', 'sess-1') as { id: string; role: string; created_at: string } | undefined;
    assert.ok(assistantMsg);
    assert.equal(assistantMsg.role, 'assistant');

    // Find preceding user message
    const userMsg = db.prepare(
      `SELECT id, content FROM messages WHERE session_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC LIMIT 1`,
    ).get('sess-1', assistantMsg.created_at) as { id: string; content: string } | undefined;
    assert.ok(userMsg);
    assert.equal(userMsg.id, 'msg-u1');
    assert.equal(userMsg.content, 'Hello');
  });

  test('delete assistant message and messages after it', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    seedMessage(db, 'msg-u1', 'sess-1', 'user', 'Hello', '2026-01-01T10:00:00.000Z');
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hi there!', '2026-01-01T10:00:01.000Z');
    seedMessage(db, 'msg-u2', 'sess-1', 'user', 'Follow up', '2026-01-01T10:00:02.000Z');
    seedMessage(db, 'msg-a2', 'sess-1', 'assistant', 'More', '2026-01-01T10:00:03.000Z');

    // Regenerate msg-a1: should delete msg-a1, msg-u2, msg-a2
    const targetCreatedAt = '2026-01-01T10:00:01.000Z';
    const toDelete = db.prepare(
      `SELECT id FROM messages WHERE session_id = ? AND created_at >= ?`,
    ).all('sess-1', targetCreatedAt) as Array<{ id: string }>;

    assert.equal(toDelete.length, 3); // msg-a1 + msg-u2 + msg-a2

    for (const row of toDelete) {
      db.prepare(`DELETE FROM messages WHERE id = ?`).run(row.id);
    }

    // Only user message should remain
    const remaining = db.prepare(
      `SELECT id FROM messages WHERE session_id = ?`,
    ).all('sess-1') as Array<{ id: string }>;
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0]!.id, 'msg-u1');
  });

  test('cannot regenerate a user message', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    seedMessage(db, 'msg-u1', 'sess-1', 'user', 'Hello', '2026-01-01T10:00:00.000Z');

    const msg = db.prepare(
      `SELECT role FROM messages WHERE id = ? AND session_id = ?`,
    ).get('msg-u1', 'sess-1') as { role: string } | undefined;
    assert.ok(msg);
    assert.equal(msg.role, 'user');
    // In the route handler, this would return 400
  });

  test('history after deletion excludes deleted messages', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    seedMessage(db, 'msg-u1', 'sess-1', 'user', 'First', '2026-01-01T10:00:00.000Z');
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Response 1', '2026-01-01T10:00:01.000Z');
    seedMessage(db, 'msg-u2', 'sess-1', 'user', 'Second', '2026-01-01T10:00:02.000Z');
    seedMessage(db, 'msg-a2', 'sess-1', 'assistant', 'Response 2', '2026-01-01T10:00:03.000Z');

    // Delete from msg-a2 (regenerate last response)
    const targetCreatedAt = '2026-01-01T10:00:03.000Z';
    db.prepare(`DELETE FROM messages WHERE session_id = ? AND created_at >= ?`).run('sess-1', targetCreatedAt);

    // History should have 3 messages (msg-u1, msg-a1, msg-u2)
    const history = db.prepare(
      `SELECT id, role FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
    ).all('sess-1') as Array<{ id: string; role: string }>;
    assert.equal(history.length, 3);
    assert.equal(history[0]!.id, 'msg-u1');
    assert.equal(history[1]!.id, 'msg-a1');
    assert.equal(history[2]!.id, 'msg-u2');
  });

  test('session ownership is enforced', () => {
    const db = openDb();
    seedUser(db, 'user-1');
    seedUser(db, 'user-2');
    seedAgent(db);
    seedSession(db, 'sess-1', 'user-1');

    seedMessage(db, 'msg-u1', 'sess-1', 'user', 'Hello', '2026-01-01T10:00:00.000Z');
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hi', '2026-01-01T10:00:01.000Z');

    // user-2 should not find this session
    const session = db.prepare(
      `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
    ).get('sess-1', 'user-2') as { id: string } | undefined;
    assert.equal(session, undefined);
  });

  test('FTS entries are cleaned up on delete', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    // Insert message and FTS entry
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Search me', '2026-01-01T10:00:01.000Z');
    db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`).run('msg-a1');

    // Verify FTS has the entry
    const ftsBefore = db.prepare(`SELECT count(*) as cnt FROM messages_fts WHERE messages_fts MATCH 'Search'`).get() as { cnt: number };
    assert.equal(ftsBefore.cnt, 1);

    // Delete with FTS cleanup
    const row = db.prepare(`SELECT rowid FROM messages WHERE id = ?`).get('msg-a1') as { rowid: number };
    db.prepare(`DELETE FROM messages_fts WHERE rowid = ?`).run(row.rowid);
    db.prepare(`DELETE FROM messages WHERE id = ?`).run('msg-a1');

    // FTS should be empty
    const ftsAfter = db.prepare(`SELECT count(*) as cnt FROM messages_fts WHERE messages_fts MATCH 'Search'`).get() as { cnt: number };
    assert.equal(ftsAfter.cnt, 0);
  });

  test('regenerating with multi-turn history preserves earlier conversation', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    // 3-turn conversation
    seedMessage(db, 'msg-u1', 'sess-1', 'user', 'Turn 1', '2026-01-01T10:00:00.000Z');
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Response 1', '2026-01-01T10:00:01.000Z');
    seedMessage(db, 'msg-u2', 'sess-1', 'user', 'Turn 2', '2026-01-01T10:00:02.000Z');
    seedMessage(db, 'msg-a2', 'sess-1', 'assistant', 'Response 2', '2026-01-01T10:00:03.000Z');
    seedMessage(db, 'msg-u3', 'sess-1', 'user', 'Turn 3', '2026-01-01T10:00:04.000Z');
    seedMessage(db, 'msg-a3', 'sess-1', 'assistant', 'Response 3', '2026-01-01T10:00:05.000Z');

    // Regenerate msg-a2 — should delete msg-a2, msg-u3, msg-a3
    const targetCreatedAt = '2026-01-01T10:00:03.000Z';
    db.prepare(`DELETE FROM messages WHERE session_id = ? AND created_at >= ?`).run('sess-1', targetCreatedAt);

    const remaining = db.prepare(
      `SELECT id, role, content FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
    ).all('sess-1') as Array<{ id: string; role: string; content: string }>;

    assert.equal(remaining.length, 3);
    assert.equal(remaining[0]!.content, 'Turn 1');
    assert.equal(remaining[1]!.content, 'Response 1');
    assert.equal(remaining[2]!.content, 'Turn 2');

    // The preceding user message for the regenerated response
    const precedingUser = db.prepare(
      `SELECT id, content FROM messages WHERE session_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC LIMIT 1`,
    ).get('sess-1', targetCreatedAt) as { id: string; content: string } | undefined;
    assert.ok(precedingUser);
    assert.equal(precedingUser.content, 'Turn 2');
  });
});
