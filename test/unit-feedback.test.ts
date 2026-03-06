/**
 * unit-feedback.test.ts
 * 消息反馈机制单元测试 — 内存 SQLite
 *
 * 验证：
 * 1. message_feedback 表 schema 存在
 * 2. 插入 rating=1 成功
 * 3. 同 message_id/user_id 再插 rating=-1 → UPSERT，行数仍为 1，rating 变 -1
 *
 * 运行：npx tsx test/unit-feedback.test.ts
 */

import Database from 'better-sqlite3';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── 内存 DB + 同 db.ts 的 schema SQL ────────────────────────────────────

let db: InstanceType<typeof Database>;

function setupSchema() {
  db = new Database(':memory:');

  // 仅建 session_messages（message_feedback 有 FK 到 sessions，简化为只建依赖的最小表）
  db.exec(`
    CREATE TABLE sessions (
      session_id TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE session_messages (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT NOT NULL REFERENCES sessions(session_id),
      role          TEXT NOT NULL,
      content       TEXT NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE message_feedback (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      session_id TEXT NOT NULL,
      user_id    TEXT NOT NULL,
      rating     INTEGER NOT NULL,
      comment    TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(message_id, user_id)
    );

    CREATE INDEX idx_message_feedback_session ON message_feedback(session_id);
  `);

  // 插入测试 session 和 message
  db.prepare("INSERT INTO sessions (session_id, user_id) VALUES ('sess1', 'u1')").run();
  db.prepare("INSERT INTO session_messages (session_id, role, content) VALUES ('sess1', 'assistant', 'Hello')").run();
}

// ─── 辅助函数 ─────────────────────────────────────────────────────────────

function getMessageId(): number {
  return (db.prepare('SELECT id FROM session_messages LIMIT 1').get() as { id: number }).id;
}

function insertFeedback(message_id: number, user_id: string, rating: number, comment?: string) {
  return db.prepare(`
    INSERT INTO message_feedback (message_id, session_id, user_id, rating, comment)
    VALUES (?, 'sess1', ?, ?, ?)
    ON CONFLICT(message_id, user_id) DO UPDATE SET rating = excluded.rating, comment = excluded.comment
  `).run(message_id, user_id, rating, comment ?? null);
}

function countFeedback(): number {
  return (db.prepare('SELECT COUNT(*) as c FROM message_feedback').get() as { c: number }).c;
}

function getFeedback(message_id: number, user_id: string) {
  return db.prepare('SELECT * FROM message_feedback WHERE message_id = ? AND user_id = ?').get(message_id, user_id) as
    { id: number; message_id: number; user_id: string; rating: number; comment: string | null } | undefined;
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe('unit-feedback: schema 验证', () => {
  setupSchema();

  test('message_feedback 表存在', () => {
    const info = db.pragma('table_info(message_feedback)') as { name: string }[];
    const cols = info.map(r => r.name);
    assert.ok(cols.includes('id'), 'id 列存在');
    assert.ok(cols.includes('message_id'), 'message_id 列存在');
    assert.ok(cols.includes('session_id'), 'session_id 列存在');
    assert.ok(cols.includes('user_id'), 'user_id 列存在');
    assert.ok(cols.includes('rating'), 'rating 列存在');
    assert.ok(cols.includes('comment'), 'comment 列存在');
  });

  test('UNIQUE 约束 (message_id, user_id) 存在', () => {
    const indexes = db.pragma('index_list(message_feedback)') as { name: string; unique: number }[];
    const hasUnique = indexes.some(idx => idx.unique === 1);
    assert.ok(hasUnique, 'message_feedback 应有 UNIQUE 约束');
  });
});

describe('unit-feedback: 插入与 UPSERT', () => {
  test('插入 rating=1 成功，行数为 1', () => {
    const mid = getMessageId();
    const result = insertFeedback(mid, 'u1', 1);
    assert.equal(result.changes, 1, '应写入 1 行');
    assert.equal(countFeedback(), 1, '表中应有 1 条记录');

    const row = getFeedback(mid, 'u1');
    assert.ok(row, '应能查到记录');
    assert.equal(row!.rating, 1);
  });

  test('同 message_id/user_id 再插 rating=-1 → UPSERT，行数仍为 1，rating 变 -1', () => {
    const mid = getMessageId();
    insertFeedback(mid, 'u1', 1);     // 已在上个 test 插入，这里幂等
    insertFeedback(mid, 'u1', -1, '太慢了');  // UPSERT

    assert.equal(countFeedback(), 1, 'UPSERT 后行数仍为 1');
    const row = getFeedback(mid, 'u1');
    assert.equal(row!.rating, -1, 'rating 应更新为 -1');
    assert.equal(row!.comment, '太慢了', 'comment 应同步更新');
  });

  test('不同 user_id 对同一消息可分别打分', () => {
    const mid = getMessageId();
    insertFeedback(mid, 'u2', 1);
    insertFeedback(mid, 'u3', -1);
    assert.equal(countFeedback(), 3, '包括前一个 test 的 u1，共 3 条');

    const r2 = getFeedback(mid, 'u2');
    const r3 = getFeedback(mid, 'u3');
    assert.equal(r2!.rating, 1);
    assert.equal(r3!.rating, -1);
  });

  test('rating 为 0（中立）也能存储', () => {
    const mid = getMessageId();
    insertFeedback(mid, 'u4', 0, '无感');
    const row = getFeedback(mid, 'u4');
    assert.equal(row!.rating, 0);
  });
});

console.log('\n✅ unit-feedback 测试已注册，执行中...\n');
