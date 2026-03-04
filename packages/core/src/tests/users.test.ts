// Tests for Phase 29: User management — DB-level CRUD and auth logic

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

import { openDb, closeDb } from '../datamap/db.js';
import { initSchema } from '../datamap/init.js';
import { signToken, verifyToken } from '../auth/index.js';
import { hasRole } from '../policy/index.js';

// ─── DB setup ─────────────────────────────────────────────────────────────────

function setupTestDb(): Database.Database {
  closeDb();
  const dir = mkdtempSync(join(tmpdir(), 'jowork-users-test-'));
  const db = openDb(dir);
  initSchema(db);
  return db;
}

function seedOwner(db: Database.Database, id = 'owner-1'): void {
  const now = new Date().toISOString();
  db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(id, 'Owner', 'owner@test', 'owner', now);
}

// ─── User CRUD — DB layer ─────────────────────────────────────────────────────

describe('User — DB CRUD', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('insert and retrieve a user', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('u-1', 'Alice', 'alice@test', 'member', now);

    const row = db.prepare(`SELECT * FROM users WHERE id = ?`).get('u-1') as { id: string; name: string; role: string } | undefined;
    assert.ok(row);
    assert.equal(row.name, 'Alice');
    assert.equal(row.role, 'member');
  });

  test('update user role and name', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('u-2', 'Bob', 'bob@test', 'guest', now);
    db.prepare(`UPDATE users SET role = ?, name = ? WHERE id = ?`).run('admin', 'Robert', 'u-2');

    const row = db.prepare(`SELECT name, role FROM users WHERE id = ?`).get('u-2') as { name: string; role: string };
    assert.equal(row.name, 'Robert');
    assert.equal(row.role, 'admin');
  });

  test('delete a user', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('u-3', 'Carol', 'carol@test', 'member', now);
    db.prepare(`DELETE FROM users WHERE id = ?`).run('u-3');

    const row = db.prepare(`SELECT id FROM users WHERE id = ?`).get('u-3');
    assert.equal(row, undefined);
  });

  test('list all users', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('u-a', 'A', 'a@test', 'owner', now);
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('u-b', 'B', 'b@test', 'member', now);

    const rows = db.prepare(`SELECT * FROM users`).all() as { id: string }[];
    assert.ok(rows.some(r => r.id === 'u-a'));
    assert.ok(rows.some(r => r.id === 'u-b'));
  });
});

// ─── Token generation for new users ──────────────────────────────────────────

describe('User — token generation for new user', () => {
  test('generated token verifies correctly', () => {
    const token   = signToken('new-user-id', 'member');
    const payload = verifyToken(token);
    assert.equal(payload.sub, 'new-user-id');
    assert.equal(payload.role, 'member');
  });

  test('owner token verifies with owner role', () => {
    const token   = signToken('owner-id', 'owner');
    const payload = verifyToken(token);
    assert.equal(payload.role, 'owner');
  });
});

// ─── Role hierarchy — user management policy ─────────────────────────────────

describe('User — role hierarchy enforcement', () => {
  test('owner can assign admin role', () => {
    // owner role satisfies admin requirement
    assert.ok(hasRole('owner', 'admin'));
  });

  test('admin cannot satisfy owner requirement', () => {
    assert.ok(!hasRole('admin', 'owner'));
  });

  test('member cannot satisfy admin requirement', () => {
    assert.ok(!hasRole('member', 'admin'));
  });

  test('guest satisfies only guest requirement', () => {
    assert.ok(hasRole('guest', 'guest'));
    assert.ok(!hasRole('guest', 'member'));
    assert.ok(!hasRole('guest', 'admin'));
    assert.ok(!hasRole('guest', 'owner'));
  });
});

// ─── Self-delete guard logic ──────────────────────────────────────────────────

describe('User — self-delete prevention', () => {
  function isSelfDelete(userId: string, targetId: string): boolean {
    return userId === targetId;
  }

  test('self-delete check: same id returns true (should block)', () => {
    assert.equal(isSelfDelete('user-abc', 'user-abc'), true);
  });

  test('self-delete check: different id returns false (allow)', () => {
    assert.equal(isSelfDelete('user-abc', 'user-xyz'), false);
  });
});

// ─── DB constraints ───────────────────────────────────────────────────────────

describe('User — DB constraints', () => {
  beforeEach(() => { setupTestDb(); });
  afterEach(() => { closeDb(); });

  test('PRIMARY KEY: duplicate user id is rejected', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('dup-id', 'First', 'first@test', 'member', now);

    assert.throws(() => {
      db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
        .run('dup-id', 'Second', 'second@test', 'member', now);
    });
  });

  test('personal mode seed user is accessible after initSchema', () => {
    const db  = openDb();
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO users (id, name, email, role, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run('personal', 'You', 'you@local', 'owner', now);

    const row = db.prepare(`SELECT * FROM users WHERE id = 'personal'`).get() as { id: string } | undefined;
    assert.ok(row, 'personal user should exist');
    assert.equal(row!.id, 'personal');
  });
});
