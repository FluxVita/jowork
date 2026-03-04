// Tests for Phase 67: Message Feedback (thumbs up/down) — DB-level logic

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { generateId, nowISO } from '../utils/index.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function setupTestDb(): Database.Database {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-feedback-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: Database.Database, id = 'user-1'): void {
  const now = nowISO();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Test User', `${id}@test`, 'owner', now);
}

function seedAgent(db: Database.Database, id = 'agent-1', ownerId = 'user-1'): void {
  const now = nowISO();
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, 'Test Agent', ownerId, 'You are a test agent.', 'claude-3-haiku', now);
}

function seedSession(db: Database.Database, id = 'sess-1', userId = 'user-1', agentId = 'agent-1'): void {
  const now = nowISO();
  db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, agentId, userId, 'Test Session', now, now);
}

function seedMessage(db: Database.Database, id: string, sessionId: string, role: string, content: string): void {
  const now = nowISO();
  db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
    .run(id, sessionId, role, content, now);
}

// ─── Feedback — DB operations ──────────────────────────────────────────────

describe('Message Feedback — DB operations', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('message_feedback table exists after initSchema', () => {
    const db = openDb();
    const row = db.prepare(
      `SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='message_feedback'`,
    ).get() as { cnt: number };
    assert.equal(row.cnt, 1);
  });

  test('insert positive feedback', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hello!');

    const id = generateId();
    const now = nowISO();
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
    ).run(id, 'msg-a1', 'user-1', 'positive', now);

    const fb = db.prepare(`SELECT * FROM message_feedback WHERE id = ?`).get(id) as {
      id: string; message_id: string; user_id: string; rating: string; comment: string | null;
    };
    assert.equal(fb.rating, 'positive');
    assert.equal(fb.comment, null);
  });

  test('insert negative feedback with comment', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hello!');

    const id = generateId();
    const now = nowISO();
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, comment, created_at) VALUES (?,?,?,?,?,?)`,
    ).run(id, 'msg-a1', 'user-1', 'negative', 'Not helpful', now);

    const fb = db.prepare(`SELECT * FROM message_feedback WHERE id = ?`).get(id) as {
      rating: string; comment: string | null;
    };
    assert.equal(fb.rating, 'negative');
    assert.equal(fb.comment, 'Not helpful');
  });

  test('UNIQUE constraint: one feedback per message per user', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hello!');

    const now = nowISO();
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
    ).run('fb-1', 'msg-a1', 'user-1', 'positive', now);

    assert.throws(() => {
      db.prepare(
        `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
      ).run('fb-2', 'msg-a1', 'user-1', 'negative', now);
    });
  });

  test('CHECK constraint: rating must be positive or negative', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hello!');

    const now = nowISO();
    assert.throws(() => {
      db.prepare(
        `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
      ).run('fb-1', 'msg-a1', 'user-1', 'neutral', now);
    });
  });

  test('cascade delete: feedback removed when message is deleted', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hello!');

    const now = nowISO();
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
    ).run('fb-1', 'msg-a1', 'user-1', 'positive', now);

    // Delete the message
    db.prepare(`DELETE FROM messages WHERE id = ?`).run('msg-a1');

    // Feedback should be cascade-deleted
    const fb = db.prepare(`SELECT * FROM message_feedback WHERE id = ?`).get('fb-1');
    assert.equal(fb, undefined);
  });

  test('batch query: get all feedback for a session', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'First');
    seedMessage(db, 'msg-a2', 'sess-1', 'assistant', 'Second');

    const now = nowISO();
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
    ).run('fb-1', 'msg-a1', 'user-1', 'positive', now);
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
    ).run('fb-2', 'msg-a2', 'user-1', 'negative', now);

    const rows = db.prepare(
      `SELECT mf.message_id, mf.rating FROM message_feedback mf
       JOIN messages m ON m.id = mf.message_id
       WHERE m.session_id = ? AND mf.user_id = ?`,
    ).all('sess-1', 'user-1') as Array<{ message_id: string; rating: string }>;

    assert.equal(rows.length, 2);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.message_id] = r.rating;
    assert.equal(map['msg-a1'], 'positive');
    assert.equal(map['msg-a2'], 'negative');
  });

  test('update feedback (upsert pattern)', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hello!');

    const now = nowISO();
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
    ).run('fb-1', 'msg-a1', 'user-1', 'positive', now);

    // Update to negative
    db.prepare(`UPDATE message_feedback SET rating = ? WHERE id = ?`).run('negative', 'fb-1');

    const fb = db.prepare(`SELECT rating FROM message_feedback WHERE id = ?`).get('fb-1') as { rating: string };
    assert.equal(fb.rating, 'negative');
  });

  test('delete feedback', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-a1', 'sess-1', 'assistant', 'Hello!');

    const now = nowISO();
    db.prepare(
      `INSERT INTO message_feedback (id, message_id, user_id, rating, created_at) VALUES (?,?,?,?,?)`,
    ).run('fb-1', 'msg-a1', 'user-1', 'positive', now);

    db.prepare(`DELETE FROM message_feedback WHERE message_id = ? AND user_id = ?`).run('msg-a1', 'user-1');

    const fb = db.prepare(`SELECT * FROM message_feedback WHERE message_id = ?`).get('msg-a1');
    assert.equal(fb, undefined);
  });
});
