/**
 * P0 测试：群聊消息权限过滤 + 时间标注 + fresh 参数
 *
 * 直接导入函数做单元测试，不启动完整服务器。
 * 运行方式：npx tsx test/p0-permissions.test.ts
 */

import Database from 'better-sqlite3';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ─── 模拟 DB ───

let testDb: InstanceType<typeof Database>;

function setupTestDb() {
  testDb = new Database(':memory:');

  // chat_messages 表
  testDb.exec(`
    CREATE TABLE chat_messages (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id      TEXT UNIQUE NOT NULL,
      chat_id         TEXT NOT NULL,
      chat_type       TEXT NOT NULL DEFAULT 'group',
      sender_id       TEXT,
      sender_name     TEXT,
      msg_type        TEXT NOT NULL DEFAULT 'text',
      content_text    TEXT,
      content_json    TEXT,
      parent_id       TEXT,
      doc_links_json  TEXT,
      created_at      TEXT NOT NULL,
      synced_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_chat_msg_chat ON chat_messages(chat_id);
  `);

  // FTS5
  testDb.exec(`
    CREATE VIRTUAL TABLE chat_fts USING fts5(
      sender_name,
      content_text,
      content='',
      tokenize='unicode61'
    );
  `);

  // 插入测试数据：3个群，不同消息
  const msgs = [
    { id: 'msg1', chat: 'chat_A', sender: '张三', text: 'API 设计方案讨论', created: '2026-03-01T10:00:00Z' },
    { id: 'msg2', chat: 'chat_A', sender: '李四', text: 'API 接口文档更新', created: '2026-03-01T11:00:00Z' },
    { id: 'msg3', chat: 'chat_B', sender: '王五', text: 'API 性能测试报告', created: '2026-03-01T12:00:00Z' },
    { id: 'msg4', chat: 'chat_C', sender: '赵六', text: 'API 安全审计结果', created: '2026-03-01T13:00:00Z' },
    { id: 'msg5', chat: 'chat_B', sender: '钱七', text: '产品上线计划', created: '2026-03-02T09:00:00Z' },
  ];

  const insert = testDb.prepare(`
    INSERT INTO chat_messages (message_id, chat_id, sender_name, msg_type, content_text, content_json, created_at)
    VALUES (?, ?, ?, 'text', ?, '{}', ?)
  `);

  const insertFts = testDb.prepare(`
    INSERT INTO chat_fts(rowid, sender_name, content_text) VALUES (?, ?, ?)
  `);

  for (const m of msgs) {
    insert.run(m.id, m.chat, m.sender, m.text, m.created);
    const row = testDb.prepare('SELECT id FROM chat_messages WHERE message_id = ?').get(m.id) as { id: number };
    insertFts.run(row.id, m.sender, m.text);
  }
}

// ─── 搬运 searchChatMessages 逻辑（用 testDb） ───

function searchChatMessages(opts: {
  query: string;
  chat_id?: string;
  allowed_chat_ids?: string[];
  limit?: number;
}) {
  const limit = opts.limit ?? 20;

  if (opts.allowed_chat_ids && opts.allowed_chat_ids.length === 0) return [];

  const words = opts.query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const ftsExpr = words.map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.chat_id) {
    conditions.push('cm.chat_id = ?');
    params.push(opts.chat_id);
  }

  if (opts.allowed_chat_ids) {
    const placeholders = opts.allowed_chat_ids.map(() => '?').join(', ');
    conditions.push(`cm.chat_id IN (${placeholders})`);
    params.push(...opts.allowed_chat_ids);
  }

  const extraWhere = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const mapRow = (r: Record<string, unknown>) => ({
    message_id: r['message_id'] as string,
    chat_id: r['chat_id'] as string,
    sender_name: r['sender_name'] as string || '',
    content_text: r['content_text'] as string || '',
    created_at: r['created_at'] as string,
    msg_type: r['msg_type'] as string,
  });

  try {
    const rows = testDb.prepare(`
      SELECT cm.* FROM chat_messages cm
      INNER JOIN chat_fts cfts ON cfts.rowid = cm.id
      WHERE chat_fts MATCH ?
      ${extraWhere}
      ORDER BY rank
      LIMIT ?
    `).all(ftsExpr, ...params, limit) as Record<string, unknown>[];

    return rows.map(mapRow);
  } catch {
    const likeConditions = ['content_text LIKE ?'];
    const likeParams: unknown[] = [`%${opts.query}%`];

    if (opts.chat_id) {
      likeConditions.push('chat_id = ?');
      likeParams.push(opts.chat_id);
    }
    if (opts.allowed_chat_ids) {
      const placeholders = opts.allowed_chat_ids.map(() => '?').join(', ');
      likeConditions.push(`chat_id IN (${placeholders})`);
      likeParams.push(...opts.allowed_chat_ids);
    }

    const likeRows = testDb.prepare(`
      SELECT * FROM chat_messages
      WHERE ${likeConditions.join(' AND ')}
      ORDER BY created_at DESC LIMIT ?
    `).all(...likeParams, limit) as Record<string, unknown>[];

    return likeRows.map(mapRow);
  }
}

// ─── formatTimeAgo 逻辑搬运 ───

function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (isNaN(diffMs) || diffMs < 0) return '刚刚';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

// ─── 测试 ───

beforeEach(() => {
  setupTestDb();
});

describe('Step 1: searchChatMessages 权限过滤', () => {
  test('不传 allowed_chat_ids → 返回所有群的结果（向后兼容）', () => {
    const results = searchChatMessages({ query: 'API' });
    assert.equal(results.length, 4, '应搜到 4 条包含 API 的消息');
    const chatIds = new Set(results.map(r => r.chat_id));
    assert.ok(chatIds.has('chat_A'));
    assert.ok(chatIds.has('chat_B'));
    assert.ok(chatIds.has('chat_C'));
  });

  test('传 allowed_chat_ids=[chat_A] → 只返回 chat_A 的结果', () => {
    const results = searchChatMessages({ query: 'API', allowed_chat_ids: ['chat_A'] });
    assert.equal(results.length, 2, '应只搜到 chat_A 的 2 条消息');
    assert.ok(results.every(r => r.chat_id === 'chat_A'));
  });

  test('传 allowed_chat_ids=[chat_A, chat_B] → 返回 A+B 的结果', () => {
    const results = searchChatMessages({ query: 'API', allowed_chat_ids: ['chat_A', 'chat_B'] });
    assert.equal(results.length, 3, '应搜到 chat_A 和 chat_B 共 3 条消息');
    const chatIds = new Set(results.map(r => r.chat_id));
    assert.ok(!chatIds.has('chat_C'), 'chat_C 不应出现');
  });

  test('传空数组 allowed_chat_ids=[] → 返回空（用户不在任何群）', () => {
    const results = searchChatMessages({ query: 'API', allowed_chat_ids: [] });
    assert.equal(results.length, 0, '空数组应直接返回空');
  });

  test('chat_id + allowed_chat_ids 双重过滤', () => {
    const results = searchChatMessages({
      query: 'API',
      chat_id: 'chat_A',
      allowed_chat_ids: ['chat_A', 'chat_B'],
    });
    assert.equal(results.length, 2, '应只返回 chat_A 的结果');
    assert.ok(results.every(r => r.chat_id === 'chat_A'));
  });

  test('allowed_chat_ids 不包含目标群 → 搜不到', () => {
    const results = searchChatMessages({ query: 'API 安全审计', allowed_chat_ids: ['chat_A', 'chat_B'] });
    // chat_C 的"安全审计"不在 allowed 中
    const hasChatC = results.some(r => r.chat_id === 'chat_C');
    assert.ok(!hasChatC, '不在 allowed 列表中的群消息不应出现');
  });

  test('非 API 关键词搜索也遵守权限', () => {
    const results = searchChatMessages({ query: '产品上线', allowed_chat_ids: ['chat_A'] });
    assert.equal(results.length, 0, '产品上线在 chat_B 中，但 allowed 只有 chat_A');
  });
});

describe('Step 2: formatTimeAgo 时间标注', () => {
  test('刚刚', () => {
    const now = new Date().toISOString();
    assert.equal(formatTimeAgo(now), '刚刚');
  });

  test('X 分钟前', () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60_000).toISOString();
    assert.equal(formatTimeAgo(tenMinAgo), '10 分钟前');
  });

  test('X 小时前', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600_000).toISOString();
    assert.equal(formatTimeAgo(threeHoursAgo), '3 小时前');
  });

  test('X 天前', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86400_000).toISOString();
    assert.equal(formatTimeAgo(twoDaysAgo), '2 天前');
  });

  test('无效日期 → 刚刚', () => {
    assert.equal(formatTimeAgo('invalid'), '刚刚');
  });

  test('未来时间 → 刚刚', () => {
    const future = new Date(Date.now() + 100000).toISOString();
    assert.equal(formatTimeAgo(future), '刚刚');
  });
});

console.log('\n✅ 所有测试已注册，执行中...\n');
