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

function seedSession(db: Database.Database, id = 'sess-1', userId = 'user-1', agentId = 'agent-1', title = 'Test Session', opts: { pinned?: number; folder?: string | null; forkedFrom?: string | null } = {}): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO sessions (id, agent_id, user_id, title, pinned, folder, forked_from, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, agentId, userId, title, opts.pinned ?? 0, opts.folder ?? null, opts.forkedFrom ?? null, now, now);
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

// ─── Auto-title generation logic (Phase 52) ───────────────────────────────────

const AUTO_TITLE_MAX_LEN = 50;
const AUTO_TITLE_PLACEHOLDER = 'New chat';

function buildAutoTitle(userMessage: string): string {
  const trimmed = userMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length > AUTO_TITLE_MAX_LEN
    ? trimmed.slice(0, AUTO_TITLE_MAX_LEN).trimEnd() + '…'
    : trimmed;
}

describe('Auto-title — buildAutoTitle()', () => {
  test('short message is used as-is', () => {
    assert.equal(buildAutoTitle('Hello!'), 'Hello!');
  });

  test('message exactly 50 chars is not truncated', () => {
    const msg = 'a'.repeat(AUTO_TITLE_MAX_LEN);
    assert.equal(buildAutoTitle(msg), msg);
    assert.equal(buildAutoTitle(msg).endsWith('…'), false);
  });

  test('message longer than 50 chars is truncated with ellipsis', () => {
    const msg = 'a'.repeat(AUTO_TITLE_MAX_LEN + 10);
    const title = buildAutoTitle(msg);
    assert.ok(title.endsWith('…'));
    assert.ok(title.length <= AUTO_TITLE_MAX_LEN + 1); // '…' is 1 char
  });

  test('leading/trailing whitespace is trimmed', () => {
    assert.equal(buildAutoTitle('  Hello world  '), 'Hello world');
  });

  test('internal whitespace is collapsed', () => {
    assert.equal(buildAutoTitle('Hello   world'), 'Hello world');
  });
});

describe('Auto-title — maybeAutoTitle DB logic', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('updates title when placeholder + no prior messages', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 'sess-1', 'user-1', 'agent-1');
    // Simulate: historyLengthBefore = 0, title = 'New chat'
    const currentTitle = 'New chat';
    const historyLengthBefore = 0;
    const userMessage = 'Can you help me write a report?';
    const now = new Date().toISOString();
    let newTitle: string | null = null;
    if (currentTitle === AUTO_TITLE_PLACEHOLDER && historyLengthBefore === 0) {
      newTitle = buildAutoTitle(userMessage);
      db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(newTitle, now, 'sess-1');
    }
    assert.ok(newTitle);
    const row = db.prepare(`SELECT title FROM sessions WHERE id = ?`).get('sess-1') as { title: string };
    assert.equal(row.title, newTitle);
  });

  test('does NOT update title when session already has a custom title', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 'sess-1', 'user-1', 'agent-1');
    db.prepare(`UPDATE sessions SET title = ? WHERE id = ?`).run('Custom title', 'sess-1');

    // Simulate maybeAutoTitle: currentTitle !== placeholder → skip
    const row = db.prepare(`SELECT title FROM sessions WHERE id = ?`).get('sess-1') as { title: string };
    const shouldUpdate = row.title === AUTO_TITLE_PLACEHOLDER;
    assert.equal(shouldUpdate, false, 'should not auto-title when title is custom');
  });

  test('does NOT update title on subsequent messages (historyLengthBefore > 0)', () => {
    // Simulate maybeAutoTitle: historyLengthBefore > 0 → skip
    function maybeAutoTitleSim(title: string, historyLen: number, msg: string): string | null {
      if (title !== AUTO_TITLE_PLACEHOLDER) return null;
      if (historyLen > 0) return null;
      return buildAutoTitle(msg);
    }
    const result = maybeAutoTitleSim(AUTO_TITLE_PLACEHOLDER, 2, 'Follow-up question');
    assert.equal(result, null, 'should not auto-title on follow-up messages');
  });
});

// ─── Message editing (Phase 69) ─────────────────────────────────────────────

describe('Message editing — DB layer', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('edit a user message updates content', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-1', 'sess-1', 'user', 'Original text');

    db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run('Edited text', 'msg-1');

    const row = db.prepare(`SELECT content FROM messages WHERE id = ?`).get('msg-1') as { content: string };
    assert.equal(row.content, 'Edited text');
  });

  test('only user messages should be editable (logic check)', () => {
    // Role guard: only allow editing when role === 'user'
    function canEdit(role: string): boolean { return role === 'user'; }
    assert.equal(canEdit('user'), true);
    assert.equal(canEdit('assistant'), false);
    assert.equal(canEdit('system'), false);
  });

  test('edit updates FTS index', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    seedMessage(db, 'msg-1', 'sess-1', 'user', 'Original searchable text');

    // Insert into FTS
    db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`).run('msg-1');

    // Verify original is searchable
    const before = db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?`).all('Original');
    assert.ok(before.length > 0, 'Original text should be in FTS');

    // Edit: delete FTS BEFORE update (external content table needs old content to delete)
    const row = db.prepare(`SELECT rowid, content FROM messages WHERE id = ?`).get('msg-1') as { rowid: number; content: string };
    db.prepare(`INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', ?, ?)`).run(row.rowid, row.content);
    db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run('Completely new text', 'msg-1');
    db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`).run('msg-1');

    // Verify new text is searchable
    const after = db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?`).all('Completely');
    assert.ok(after.length > 0, 'New text should be in FTS');

    // Verify old text is no longer searchable
    const oldGone = db.prepare(`SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?`).all('Original');
    assert.equal(oldGone.length, 0, 'Original text should be removed from FTS');
  });

  test('edit preserves other message fields', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);
    const ts = '2026-01-15T12:00:00.000Z';
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-ts', 'sess-1', 'user', 'Before', ts);

    db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run('After', 'msg-ts');

    const row = db.prepare(`SELECT * FROM messages WHERE id = ?`).get('msg-ts') as { role: string; created_at: string; content: string };
    assert.equal(row.content, 'After');
    assert.equal(row.role, 'user');
    assert.equal(row.created_at, ts);
  });

  test('cross-user isolation: cannot edit message in another user session', () => {
    const db = openDb();
    seedUser(db, 'user-1');
    seedUser(db, 'user-2');
    seedAgent(db);
    seedSession(db, 'sess-1', 'user-1');
    seedMessage(db, 'msg-1', 'sess-1', 'user', 'Private msg');

    // Simulate ownership check: user-2 tries to find session owned by user-1
    const session = db.prepare(`SELECT id FROM sessions WHERE id = ? AND user_id = ?`).get('sess-1', 'user-2');
    assert.equal(session, undefined, 'user-2 should not find user-1 session');
  });
});

// ─── Session pinning (Phase 74) ──────────────────────────────────────────────

describe('Session — pinning', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('new session has pinned=0 by default', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    const row = db.prepare(`SELECT pinned FROM sessions WHERE id = ?`).get('sess-1') as { pinned: number };
    assert.equal(row.pinned, 0);
  });

  test('pin a session', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    db.prepare(`UPDATE sessions SET pinned = 1 WHERE id = ?`).run('sess-1');
    const row = db.prepare(`SELECT pinned FROM sessions WHERE id = ?`).get('sess-1') as { pinned: number };
    assert.equal(row.pinned, 1);
  });

  test('unpin a session', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 'sess-1', 'user-1', 'agent-1', 'Test', { pinned: 1 });

    db.prepare(`UPDATE sessions SET pinned = 0 WHERE id = ?`).run('sess-1');
    const row = db.prepare(`SELECT pinned FROM sessions WHERE id = ?`).get('sess-1') as { pinned: number };
    assert.equal(row.pinned, 0);
  });

  test('pinned sessions sort before unpinned', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-a', 'agent-1', 'user-1', 'Unpinned recent', 0, null, now, '2026-02-01T00:00:00.000Z');
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-b', 'agent-1', 'user-1', 'Pinned old', 1, null, now, '2026-01-01T00:00:00.000Z');

    const rows = db.prepare(
      `SELECT id FROM sessions WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC`,
    ).all('user-1') as { id: string }[];

    assert.equal(rows[0]!.id, 's-b', 'pinned session should come first even if older');
    assert.equal(rows[1]!.id, 's-a');
  });
});

// ─── Session folders (Phase 74) ──────────────────────────────────────────────

describe('Session — folders', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('new session has folder=null by default', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    const row = db.prepare(`SELECT folder FROM sessions WHERE id = ?`).get('sess-1') as { folder: string | null };
    assert.equal(row.folder, null);
  });

  test('assign a folder to a session', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    db.prepare(`UPDATE sessions SET folder = ? WHERE id = ?`).run('Work', 'sess-1');
    const row = db.prepare(`SELECT folder FROM sessions WHERE id = ?`).get('sess-1') as { folder: string };
    assert.equal(row.folder, 'Work');
  });

  test('remove folder (set to null)', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 'sess-1', 'user-1', 'agent-1', 'Test', { folder: 'Work' });

    db.prepare(`UPDATE sessions SET folder = NULL WHERE id = ?`).run('sess-1');
    const row = db.prepare(`SELECT folder FROM sessions WHERE id = ?`).get('sess-1') as { folder: string | null };
    assert.equal(row.folder, null);
  });

  test('filter sessions by folder', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-work', 'agent-1', 'user-1', 'Work item', 0, 'Work', now, now);
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-personal', 'agent-1', 'user-1', 'Personal item', 0, 'Personal', now, now);
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-none', 'agent-1', 'user-1', 'No folder', 0, null, now, now);

    const workRows = db.prepare(
      `SELECT id FROM sessions WHERE user_id = ? AND folder = ?`,
    ).all('user-1', 'Work') as { id: string }[];
    assert.equal(workRows.length, 1);
    assert.equal(workRows[0]!.id, 's-work');
  });

  test('list distinct folders', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-1', 'agent-1', 'user-1', 'A', 0, 'Work', now, now);
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-2', 'agent-1', 'user-1', 'B', 0, 'Work', now, now);
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-3', 'agent-1', 'user-1', 'C', 0, 'Personal', now, now);
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-4', 'agent-1', 'user-1', 'D', 0, null, now, now);

    const folders = db.prepare(
      `SELECT DISTINCT folder FROM sessions WHERE user_id = ? AND folder IS NOT NULL ORDER BY folder`,
    ).all('user-1') as Array<{ folder: string }>;
    assert.equal(folders.length, 2);
    assert.equal(folders[0]!.folder, 'Personal');
    assert.equal(folders[1]!.folder, 'Work');
  });

  test('folders are user-isolated', () => {
    const db = openDb();
    seedUser(db, 'user-1');
    seedUser(db, 'user-2');
    seedAgent(db);

    const now = new Date().toISOString();
    db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run('s-1', 'agent-1', 'user-1', 'A', 0, 'Secret', now, now);

    const folders = db.prepare(
      `SELECT DISTINCT folder FROM sessions WHERE user_id = ? AND folder IS NOT NULL`,
    ).all('user-2') as Array<{ folder: string }>;
    assert.equal(folders.length, 0, 'user-2 should not see user-1 folders');
  });
});

// ─── Session forking (Phase 75) ──────────────────────────────────────────────

describe('Session — forking', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('fork copies all messages to a new session', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 'sess-1');
    seedMessage(db, 'msg-1', 'sess-1', 'user', 'Hello');
    seedMessage(db, 'msg-2', 'sess-1', 'assistant', 'Hi there');
    seedMessage(db, 'msg-3', 'sess-1', 'user', 'Thanks');

    // Create fork
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, forked_from, created_at, updated_at) VALUES (?,?,?,?,0,NULL,?,?,?)`,
    ).run('fork-1', 'agent-1', 'user-1', 'Test Session (fork)', 'sess-1', now, now);

    // Copy messages
    const msgs = db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at`).all('sess-1') as Array<{ id: string; role: string; content: string; created_at: string }>;
    for (const m of msgs) {
      db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
        .run(`fork-${m.id}`, 'fork-1', m.role, m.content, m.created_at);
    }

    const forkedMsgs = db.prepare(`SELECT * FROM messages WHERE session_id = ?`).all('fork-1');
    assert.equal(forkedMsgs.length, 3, 'forked session should have all 3 messages');

    const forkedSession = db.prepare(`SELECT forked_from FROM sessions WHERE id = ?`).get('fork-1') as { forked_from: string };
    assert.equal(forkedSession.forked_from, 'sess-1');
  });

  test('fork copies messages up to a specific point', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 'sess-1');

    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-1', 'sess-1', 'user', 'First', '2026-01-01T10:00:00.000Z');
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-2', 'sess-1', 'assistant', 'Second', '2026-01-01T10:01:00.000Z');
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-3', 'sess-1', 'user', 'Third', '2026-01-01T10:02:00.000Z');

    // Copy only up to msg-2
    const target = db.prepare(`SELECT created_at FROM messages WHERE id = ?`).get('msg-2') as { created_at: string };
    const toCopy = db.prepare(
      `SELECT * FROM messages WHERE session_id = ? AND created_at <= ? ORDER BY created_at`,
    ).all('sess-1', target.created_at) as Array<{ content: string }>;

    assert.equal(toCopy.length, 2, 'should only copy 2 messages');
    assert.equal(toCopy[0]!.content, 'First');
    assert.equal(toCopy[1]!.content, 'Second');
  });

  test('forked_from defaults to null', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db);

    const row = db.prepare(`SELECT forked_from FROM sessions WHERE id = ?`).get('sess-1') as { forked_from: string | null };
    assert.equal(row.forked_from, null);
  });

  test('forked session is independent — deleting original does not affect fork', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 'sess-orig');
    seedMessage(db, 'msg-1', 'sess-orig', 'user', 'Hello');

    // Create fork
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, forked_from, created_at, updated_at) VALUES (?,?,?,?,0,NULL,?,?,?)`,
    ).run('sess-fork', 'agent-1', 'user-1', 'Fork', 'sess-orig', now, now);
    db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`)
      .run('msg-fork-1', 'sess-fork', 'user', 'Hello', now);

    // Delete original
    db.prepare(`DELETE FROM messages WHERE session_id = ?`).run('sess-orig');
    db.prepare(`DELETE FROM sessions WHERE id = ?`).run('sess-orig');

    // Fork should still exist
    const fork = db.prepare(`SELECT id FROM sessions WHERE id = ?`).get('sess-fork') as { id: string } | undefined;
    assert.ok(fork, 'forked session should survive original deletion');
    const forkMsgs = db.prepare(`SELECT id FROM messages WHERE session_id = ?`).all('sess-fork');
    assert.equal(forkMsgs.length, 1, 'forked messages should survive');
  });
});

// ─── Phase 77: Folder rename / delete ──────────────────────────────────────

describe('Phase 77 — folder management', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('rename folder cascades to all sessions', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 's1', 'user-1', 'agent-1', 'S1', { folder: 'work' });
    seedSession(db, 's2', 'user-1', 'agent-1', 'S2', { folder: 'work' });
    seedSession(db, 's3', 'user-1', 'agent-1', 'S3', { folder: 'personal' });

    db.prepare(`UPDATE sessions SET folder = ? WHERE user_id = ? AND folder = ?`)
      .run('projects', 'user-1', 'work');

    const rows = db.prepare(`SELECT folder FROM sessions WHERE user_id = ? ORDER BY id`).all('user-1') as Array<{ folder: string | null }>;
    assert.equal(rows[0]!.folder, 'projects');
    assert.equal(rows[1]!.folder, 'projects');
    assert.equal(rows[2]!.folder, 'personal');
  });

  test('delete folder sets folder to NULL on affected sessions', () => {
    const db = openDb();
    seedUser(db);
    seedAgent(db);
    seedSession(db, 's1', 'user-1', 'agent-1', 'S1', { folder: 'work' });
    seedSession(db, 's2', 'user-1', 'agent-1', 'S2', { folder: 'work' });
    seedSession(db, 's3', 'user-1', 'agent-1', 'S3', { folder: 'personal' });

    db.prepare(`UPDATE sessions SET folder = NULL WHERE user_id = ? AND folder = ?`)
      .run('user-1', 'work');

    const rows = db.prepare(`SELECT folder FROM sessions WHERE user_id = ? ORDER BY id`).all('user-1') as Array<{ folder: string | null }>;
    assert.equal(rows[0]!.folder, null);
    assert.equal(rows[1]!.folder, null);
    assert.equal(rows[2]!.folder, 'personal');
  });

  test('folder rename is user-isolated', () => {
    const db = openDb();
    seedUser(db, 'user-1');
    seedUser(db, 'user-2');
    seedAgent(db, 'agent-1', 'user-1');
    seedAgent(db, 'agent-2', 'user-2');
    seedSession(db, 's1', 'user-1', 'agent-1', 'S1', { folder: 'work' });
    seedSession(db, 's2', 'user-2', 'agent-2', 'S2', { folder: 'work' });

    // Only rename user-1's folders
    db.prepare(`UPDATE sessions SET folder = ? WHERE user_id = ? AND folder = ?`)
      .run('projects', 'user-1', 'work');

    const u1 = db.prepare(`SELECT folder FROM sessions WHERE id = 's1'`).get() as { folder: string };
    const u2 = db.prepare(`SELECT folder FROM sessions WHERE id = 's2'`).get() as { folder: string };
    assert.equal(u1.folder, 'projects');
    assert.equal(u2.folder, 'work');  // untouched
  });

  test('sessionsRouter exposes PATCH and DELETE folder routes', async () => {
    const { sessionsRouter } = await import('../gateway/routes/sessions.js');
    const router = sessionsRouter();
    const stack = (router as unknown as {
      stack: Array<{ route?: { path: string; methods: Record<string, boolean> } }>
    }).stack;
    const routes = stack
      .filter(l => l.route)
      .map(l => ({ path: l.route!.path, methods: Object.keys(l.route!.methods) }));

    const patchRoute = routes.find(r => r.path === '/api/sessions/folders/:name' && r.methods.includes('patch'));
    const deleteRoute = routes.find(r => r.path === '/api/sessions/folders/:name' && r.methods.includes('delete'));
    assert.ok(patchRoute, 'PATCH /api/sessions/folders/:name should exist');
    assert.ok(deleteRoute, 'DELETE /api/sessions/folders/:name should exist');
  });
});
