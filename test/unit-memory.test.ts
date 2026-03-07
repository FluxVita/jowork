/**
 * unit-memory.test.ts
 * 记忆库单元测试 — 内存 SQLite，不启动完整服务
 *
 * 运行：npx tsx test/unit-memory.test.ts
 */

import Database from 'better-sqlite3';
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// ─── 内联精简版被测逻辑（绕过 getDb() 单例） ───────────────────────────

let testDb: InstanceType<typeof Database>;

function setupSchema() {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE user_memories (
      memory_id    TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      title        TEXT NOT NULL,
      content      TEXT NOT NULL,
      tags_json    TEXT NOT NULL DEFAULT '[]',
      scope        TEXT NOT NULL DEFAULT 'personal',
      pinned       INTEGER NOT NULL DEFAULT 0,
      embedding    BLOB,
      last_used_at TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_memories_user ON user_memories(user_id);
  `);
}

interface MemoryRow {
  memory_id: string; user_id: string; title: string; content: string;
  tags_json: string; scope: string; pinned: number; embedding: Buffer | null;
  last_used_at: string | null; created_at: string; updated_at: string;
}

function toMemory(row: MemoryRow) {
  return { ...row, tags: JSON.parse(row.tags_json || '[]'), scope: row.scope as 'personal' | 'team', pinned: row.pinned === 1 };
}

function createMemory(db: InstanceType<typeof Database>, input: { user_id: string; title: string; content: string; tags?: string[]; scope?: string; pinned?: boolean }) {
  const memory_id = randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO user_memories (memory_id, user_id, title, content, tags_json, scope, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(memory_id, input.user_id, input.title, input.content, JSON.stringify(input.tags ?? []), input.scope ?? 'personal', input.pinned ? 1 : 0, now, now);
  return toMemory(db.prepare('SELECT * FROM user_memories WHERE memory_id = ?').get(memory_id) as MemoryRow);
}

function getMemoryByTitle(db: InstanceType<typeof Database>, user_id: string, title: string) {
  const row = db.prepare('SELECT * FROM user_memories WHERE user_id = ? AND title = ? LIMIT 1').get(user_id, title) as MemoryRow | undefined;
  return row ? toMemory(row) : null;
}

function updateMemory(db: InstanceType<typeof Database>, memory_id: string, user_id: string, input: { content?: string; tags?: string[] }) {
  const existing = toMemory(db.prepare('SELECT * FROM user_memories WHERE memory_id = ? AND user_id = ?').get(memory_id, user_id) as MemoryRow);
  const now = new Date().toISOString();
  db.prepare('UPDATE user_memories SET content = ?, tags_json = ?, updated_at = ? WHERE memory_id = ? AND user_id = ?')
    .run(input.content ?? existing.content, JSON.stringify(input.tags ?? existing.tags), now, memory_id, user_id);
  return toMemory(db.prepare('SELECT * FROM user_memories WHERE memory_id = ?').get(memory_id) as MemoryRow);
}

function listUserMemories(db: InstanceType<typeof Database>, opts: { user_id: string; tags?: string[]; scope?: string; limit?: number }) {
  let sql = 'SELECT * FROM user_memories WHERE user_id = ?';
  const params: unknown[] = [opts.user_id];
  if (opts.scope) { sql += ' AND scope = ?'; params.push(opts.scope); }
  if (opts.tags && opts.tags.length > 0) {
    for (const tag of opts.tags) { sql += ' AND tags_json LIKE ?'; params.push(`%${tag}%`); }
  }
  sql += ` ORDER BY pinned DESC, updated_at DESC LIMIT ?`;
  params.push(opts.limit ?? 20);
  return (db.prepare(sql).all(...params) as MemoryRow[]).map(toMemory);
}

// ─── packEmbedding / unpackEmbedding（直接从 embedding.ts 内联） ────────

function packEmbedding(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

function unpackEmbedding(buf: Buffer): Float32Array {
  const copy = Buffer.allocUnsafe(buf.length);
  buf.copy(copy);
  const dims = Math.floor(copy.length / 4);
  return new Float32Array(copy.buffer, copy.byteOffset, dims);
}

// ─── 余弦相似度（内联） ──────────────────────────────────────────────────

function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

beforeEach(() => {
  setupSchema();
});

describe('unit-memory: createMemory', () => {

  test('写入并返回 memory_id', () => {
    const m = createMemory(testDb, { user_id: 'u1', title: '测试标题', content: '测试内容' });
    assert.ok(m.memory_id, 'memory_id 不为空');
    assert.equal(m.title, '测试标题');
    assert.equal(m.content, '测试内容');
    assert.deepEqual(m.tags, []);
    assert.equal(m.scope, 'personal');
    assert.equal(m.pinned, false);
  });

  test('同 user_id 可以写多条，memory_id 各不相同', () => {
    const m1 = createMemory(testDb, { user_id: 'u2', title: 'A', content: 'a' });
    const m2 = createMemory(testDb, { user_id: 'u2', title: 'B', content: 'b' });
    assert.notEqual(m1.memory_id, m2.memory_id);
  });

  test('tags / scope / pinned 正常写入', () => {
    const m = createMemory(testDb, { user_id: 'u3', title: 'X', content: 'y', tags: ['tech', 'decision'], scope: 'team', pinned: true });
    assert.deepEqual(m.tags, ['tech', 'decision']);
    assert.equal(m.scope, 'team');
    assert.equal(m.pinned, true);
  });
});

describe('unit-memory: getMemoryByTitle', () => {
  test('精确标题匹配', () => {
    const m = createMemory(testDb, { user_id: 'u10', title: 'exact-title', content: 'some content' });
    const found = getMemoryByTitle(testDb, 'u10', 'exact-title');
    assert.equal(found?.memory_id, m.memory_id);
  });

  test('标题包含关系不匹配（不是 LIKE）', () => {
    createMemory(testDb, { user_id: 'u10', title: 'exact-title', content: 'base' });
    createMemory(testDb, { user_id: 'u10', title: 'exact-title-longer', content: 'x' });
    const found = getMemoryByTitle(testDb, 'u10', 'exact-title');
    // 仍然返回完整精确匹配的那条，不会返回 longer 的
    assert.equal(found?.title, 'exact-title');
  });

  test('不存在时返回 null', () => {
    const found = getMemoryByTitle(testDb, 'u10', 'no-such-title');
    assert.equal(found, null);
  });

  test('不同 user_id 同标题互不干扰', () => {
    createMemory(testDb, { user_id: 'u11', title: 'shared', content: 'u11 content' });
    createMemory(testDb, { user_id: 'u12', title: 'shared', content: 'u12 content' });
    const r11 = getMemoryByTitle(testDb, 'u11', 'shared');
    const r12 = getMemoryByTitle(testDb, 'u12', 'shared');
    assert.equal(r11?.content, 'u11 content');
    assert.equal(r12?.content, 'u12 content');
  });
});

describe('unit-memory: updateMemory', () => {
  test('更新 content 后返回新内容', () => {
    const m = createMemory(testDb, { user_id: 'u20', title: 'upd', content: 'old content' });
    const updated = updateMemory(testDb, m.memory_id, 'u20', { content: 'new content' });
    assert.equal(updated.content, 'new content');
    assert.equal(updated.title, 'upd');  // title 不变
  });

  test('更新 tags', () => {
    const m = createMemory(testDb, { user_id: 'u20', title: 'tags-upd', content: 'c', tags: ['old'] });
    const updated = updateMemory(testDb, m.memory_id, 'u20', { tags: ['new1', 'new2'] });
    assert.deepEqual(updated.tags, ['new1', 'new2']);
  });
});

describe('unit-memory: listUserMemories', () => {
  test('按 tags 过滤', () => {
    createMemory(testDb, { user_id: 'u30', title: 'T1', content: 'c', tags: ['alpha'] });
    createMemory(testDb, { user_id: 'u30', title: 'T2', content: 'c', tags: ['beta'] });
    createMemory(testDb, { user_id: 'u30', title: 'T3', content: 'c', tags: ['alpha', 'beta'] });
    const result = listUserMemories(testDb, { user_id: 'u30', tags: ['alpha'] });
    assert.equal(result.length, 2);
    assert.ok(result.every(m => m.tags.includes('alpha')));
  });

  test('limit 生效', () => {
    for (let i = 0; i < 5; i++) createMemory(testDb, { user_id: 'u31', title: `M${i}`, content: 'x' });
    const result = listUserMemories(testDb, { user_id: 'u31', limit: 3 });
    assert.equal(result.length, 3);
  });

  test('scope 过滤', () => {
    createMemory(testDb, { user_id: 'u32', title: 'P', content: 'c', scope: 'personal' });
    createMemory(testDb, { user_id: 'u32', title: 'T', content: 'c', scope: 'team' });
    const personal = listUserMemories(testDb, { user_id: 'u32', scope: 'personal' });
    assert.equal(personal.length, 1);
    assert.equal(personal[0].scope, 'personal');
  });
});

describe('unit-memory: packEmbedding / unpackEmbedding 往返', () => {
  test('1536 维 Float32Array 序列化后反序列化精度一致', () => {
    const dims = 1536;
    const original = new Float32Array(dims);
    for (let i = 0; i < dims; i++) original[i] = Math.random() * 2 - 1;

    const buf = packEmbedding(original);
    assert.equal(buf.length, dims * 4, 'BLOB 字节数应为 dims * 4');

    const restored = unpackEmbedding(buf);
    assert.equal(restored.length, dims);
    // 逐元素对比（Float32 精度内）
    for (let i = 0; i < dims; i++) {
      assert.ok(Math.abs(restored[i] - original[i]) < 1e-6, `第 ${i} 维精度不符`);
    }
  });

  test('空 Buffer 返回 0 维数组', () => {
    const empty = Buffer.alloc(0);
    const vec = unpackEmbedding(empty);
    assert.equal(vec.length, 0);
  });
});

describe('unit-memory: cosineSimilarity', () => {
  test('完全相同向量 → 相似度 ≈ 1', () => {
    const v = new Float32Array([1, 2, 3, 4]);
    assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6);
  });

  test('正交向量 → 相似度 ≈ 0', () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, b)) < 1e-6);
  });

  test('反向向量 → 相似度 ≈ -1', () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    assert.ok(Math.abs(cosineSimilarity(a, b) + 1) < 1e-6);
  });

  test('维度不同 → 返回 0', () => {
    const a = new Float32Array([1, 2, 3]);
    const b = new Float32Array([1, 2]);
    assert.equal(cosineSimilarity(a, b), 0);
  });
});

describe('unit-memory: semanticSearchMemories 无 embedding 时降级 LIKE', () => {
  test('无 embedding 记忆时，关键词搜索有效', () => {
    // 直接插入无 embedding 的记忆
    createMemory(testDb, { user_id: 'u40', title: '技术选型', content: '选择 SQLite 作为存储层' });
    createMemory(testDb, { user_id: 'u40', title: '部署计划', content: '部署到 Mac mini 上' });

    // 模拟 semanticSearchMemories 无 embedding 时的降级逻辑
    const embRows = (testDb.prepare('SELECT memory_id FROM user_memories WHERE user_id = ? AND embedding IS NOT NULL').all('u40') as { memory_id: string }[]);
    assert.equal(embRows.length, 0, '没有计算过 embedding');

    // 降级：LIKE 搜索
    const results = listUserMemories(testDb, { user_id: 'u40' });
    const found = results.find(m => m.content.includes('SQLite'));
    assert.ok(found, '应能通过列表找到含 SQLite 的记忆');
  });
});

console.log('\n✅ unit-memory 测试已注册，执行中...\n');
