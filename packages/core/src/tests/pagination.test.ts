// Tests for Phase 51: Message Pagination
//
// Validates the DB-level logic used by GET /api/sessions/:id/messages?before=&limit=
// and the updated GET /api/sessions/:id (hasMore + nextCursor).

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
  const dir = mkdtempSync(join(tmpdir(), 'jowork-pagination-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedUser(db: Database.Database, id = 'user-1'): void {
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?,?,?,?,?)`)
    .run(id, 'Test User', `${id}@test`, 'owner', new Date().toISOString());
}

function seedAgent(db: Database.Database, id = 'agent-1', ownerId = 'user-1'): void {
  db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?,?,?,?,?,?)`)
    .run(id, 'Test Agent', ownerId, 'sys', 'claude-3-haiku', new Date().toISOString());
}

function seedSession(db: Database.Database, id = 'sess-1', userId = 'user-1', agentId = 'agent-1'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
    .run(id, agentId, userId, 'Test Session', now, now);
}

/** Insert N sequentially-timestamped messages, returns array of IDs oldest-first. */
function seedMessages(db: Database.Database, sessionId: string, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `msg-${String(i + 1).padStart(3, '0')}`;
    ids.push(id);
    // Use second-level timestamps so ordering is deterministic
    const ts = new Date(2026, 0, 1, 0, 0, i).toISOString();
    db.prepare(`INSERT OR IGNORE INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run(id, sessionId, i % 2 === 0 ? 'user' : 'assistant', `Message ${i + 1}`, ts);
  }
  return ids;
}

// ─── PAGE_SIZE = 40 pagination logic ─────────────────────────────────────────

const PAGE_SIZE = 40;

/** Replicate the GET /api/sessions/:id pagination logic at DB level. */
function getSessionMessages(db: Database.Database, sessionId: string) {
  const rows = db.prepare(
    `SELECT id, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
  ).all(sessionId, PAGE_SIZE + 1) as Array<{ id: string; created_at: string }>;
  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE).reverse();
  const nextCursor = hasMore ? page[0]?.id ?? null : null;
  return { page, hasMore, nextCursor };
}

/** Replicate the GET /api/sessions/:id/messages?before= pagination logic at DB level. */
function getPagedMessages(db: Database.Database, sessionId: string, before: string | null, limit: number) {
  let rows: Array<{ id: string; created_at: string }>;
  if (before) {
    const cursor = db.prepare(
      `SELECT created_at FROM messages WHERE id = ? AND session_id = ?`,
    ).get(before, sessionId) as { created_at: string } | undefined;
    if (!cursor) return null; // CURSOR_NOT_FOUND
    rows = db.prepare(
      `SELECT id, created_at FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
    ).all(sessionId, cursor.created_at, limit + 1) as Array<{ id: string; created_at: string }>;
  } else {
    rows = db.prepare(
      `SELECT id, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
    ).all(sessionId, limit + 1) as Array<{ id: string; created_at: string }>;
  }
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit).reverse();
  const nextCursor = hasMore ? page[0]?.id ?? null : null;
  return { page, hasMore, nextCursor };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Message Pagination — GET /api/sessions/:id (hasMore field)', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('hasMore is false when fewer than PAGE_SIZE messages exist', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessages(db, 'sess-1', 10);

    const { page, hasMore, nextCursor } = getSessionMessages(db, 'sess-1');
    assert.equal(hasMore, false);
    assert.equal(nextCursor, null);
    assert.equal(page.length, 10);
  });

  test('hasMore is false when exactly PAGE_SIZE messages exist', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessages(db, 'sess-1', PAGE_SIZE);

    const { page, hasMore } = getSessionMessages(db, 'sess-1');
    assert.equal(hasMore, false);
    assert.equal(page.length, PAGE_SIZE);
  });

  test('hasMore is true when more than PAGE_SIZE messages exist', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    const ids = seedMessages(db, 'sess-1', PAGE_SIZE + 5);

    const { page, hasMore, nextCursor } = getSessionMessages(db, 'sess-1');
    assert.equal(hasMore, true);
    assert.equal(page.length, PAGE_SIZE);
    // nextCursor should be the oldest message in the returned page
    assert.equal(nextCursor, ids[5]); // first PAGE_SIZE messages are ids[0..4](older), page starts at ids[5]
  });

  test('returned messages are in chronological order (oldest first)', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    const ids = seedMessages(db, 'sess-1', 5);

    const { page } = getSessionMessages(db, 'sess-1');
    const returnedIds = page.map((r: { id: string }) => r.id);
    assert.deepEqual(returnedIds, ids);
  });
});

describe('Message Pagination — GET /api/sessions/:id/messages?before=', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('returns null (CURSOR_NOT_FOUND) when cursor message does not exist', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessages(db, 'sess-1', 5);

    const result = getPagedMessages(db, 'sess-1', 'nonexistent-id', 10);
    assert.equal(result, null);
  });

  test('returns messages older than cursor in chronological order', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    const ids = seedMessages(db, 'sess-1', 10);

    // Use ids[5] as cursor → should return ids[0..4]
    const result = getPagedMessages(db, 'sess-1', ids[5]!, 10);
    assert.ok(result);
    assert.equal(result.hasMore, false);
    const returnedIds = result.page.map((r: { id: string }) => r.id);
    assert.deepEqual(returnedIds, ids.slice(0, 5));
  });

  test('hasMore is true when there are more messages beyond the page', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    const ids = seedMessages(db, 'sess-1', 20);

    // Use ids[15] as cursor, limit=5 → expects ids[10..14], hasMore=true (ids[0..9] still older)
    const result = getPagedMessages(db, 'sess-1', ids[15]!, 5);
    assert.ok(result);
    assert.equal(result.hasMore, true);
    assert.equal(result.page.length, 5);
    const returnedIds = result.page.map((r: { id: string }) => r.id);
    assert.deepEqual(returnedIds, ids.slice(10, 15));
  });

  test('no cursor returns most recent limit messages', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    const ids = seedMessages(db, 'sess-1', 10);

    const result = getPagedMessages(db, 'sess-1', null, 5);
    assert.ok(result);
    assert.equal(result.hasMore, true);
    const returnedIds = result.page.map((r: { id: string }) => r.id);
    // Last 5 messages in chronological order
    assert.deepEqual(returnedIds, ids.slice(5, 10));
  });

  test('limit is capped at 100', () => {
    const rawLimit = 999;
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? PAGE_SIZE : Math.min(rawLimit, 100);
    assert.equal(limit, 100);
  });

  test('invalid limit falls back to PAGE_SIZE', () => {
    const rawLimit = NaN;
    const limit = Number.isNaN(rawLimit) || rawLimit < 1 ? PAGE_SIZE : Math.min(rawLimit, 100);
    assert.equal(limit, PAGE_SIZE);
  });
});

describe('Session filter — client-side logic', () => {
  test('empty filter returns all sessions', () => {
    const sessions = [
      { id: '1', title: 'Daily standup' },
      { id: '2', title: 'Code review' },
      { id: '3', title: 'Planning meeting' },
    ];
    const filter = '';
    const result = filter.trim() ? sessions.filter(s => s.title.toLowerCase().includes(filter.toLowerCase())) : sessions;
    assert.equal(result.length, 3);
  });

  test('filter matches case-insensitively', () => {
    const sessions = [
      { id: '1', title: 'Daily standup' },
      { id: '2', title: 'Code review' },
      { id: '3', title: 'DAILY planning' },
    ];
    const filter = 'daily';
    const result = sessions.filter(s => s.title.toLowerCase().includes(filter.toLowerCase()));
    assert.equal(result.length, 2);
    assert.equal(result[0]!.id, '1');
    assert.equal(result[1]!.id, '3');
  });

  test('filter with no matches returns empty array', () => {
    const sessions = [{ id: '1', title: 'Daily standup' }];
    const filter = 'xyz-no-match';
    const result = sessions.filter(s => s.title.toLowerCase().includes(filter.toLowerCase()));
    assert.equal(result.length, 0);
  });
});
