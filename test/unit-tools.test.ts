/**
 * unit-tools.test.ts
 * Agent 工具单元测试 — 内联核心逻辑 + 内存 SQLite
 *
 * 测试方式：构建最小化内存 DB + seed 数据，直接测试工具的核心业务逻辑
 * （不 import 实际模块，避免 getDb() 单例和外部 API 依赖）
 *
 * 验证：
 * 1. search_data 逻辑：source 过滤 → 权限裁剪 → 返回可访问对象
 * 2. run_query 逻辑：sensitivity 过滤 → 权限裁剪 → 返回结构化表格行
 * 3. write_memory 逻辑：同标题 → 更新不新建；新标题 → 新建
 * 4. read_memory 逻辑：无 embedding → fallback listUserMemories
 *
 * 运行：npx tsx test/unit-tools.test.ts
 */

import Database from 'better-sqlite3';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

// ─── 类型 ─────────────────────────────────────────────────────────────────

type Role = 'owner' | 'admin' | 'member' | 'guest';
type Sensitivity = 'public' | 'internal' | 'restricted' | 'secret';

interface ACL { read: string[]; write?: string[]; admin?: string[]; }
interface DataObject {
  object_id: string; source: string; source_type: string; uri: string;
  title: string; sensitivity: Sensitivity; acl: ACL; tags: string[];
  created_at: string; updated_at: string; last_indexed_at: string;
  ttl_seconds: number; connector_id: string; summary?: string;
  content_path?: string;
}
interface User { user_id: string; role: Role; name: string; }
interface MemoryRow { memory_id: string; user_id: string; title: string; content: string; tags_json: string; scope: string; pinned: number; embedding: Buffer | null; }

// ─── 内存 DB 建表 ─────────────────────────────────────────────────────────

let db: InstanceType<typeof Database>;

function setupSchema() {
  db = new Database(':memory:');

  db.exec(`
    -- 用户表
    CREATE TABLE users (
      user_id TEXT PRIMARY KEY,
      feishu_open_id TEXT,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'guest',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 数据对象索引
    CREATE TABLE objects (
      object_id   TEXT PRIMARY KEY,
      source      TEXT NOT NULL,
      source_type TEXT NOT NULL,
      uri         TEXT NOT NULL UNIQUE,
      title       TEXT NOT NULL,
      summary     TEXT,
      sensitivity TEXT NOT NULL DEFAULT 'internal',
      acl_json    TEXT NOT NULL DEFAULT '{"read":["role:all_staff"]}',
      tags_json   TEXT NOT NULL DEFAULT '[]',
      connector_id TEXT NOT NULL DEFAULT 'test',
      content_path TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      last_indexed_at TEXT NOT NULL DEFAULT (datetime('now')),
      ttl_seconds INTEGER NOT NULL DEFAULT 900
    );
    CREATE INDEX idx_objects_source ON objects(source);
    CREATE INDEX idx_objects_sensitivity ON objects(sensitivity);

    -- FTS（简化版，只建虚拟表）
    CREATE VIRTUAL TABLE objects_fts USING fts5(
      title, summary, content, content='', tokenize='unicode61'
    );

    -- 用户-群组映射
    CREATE TABLE user_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      UNIQUE(user_id, group_id)
    );

    -- 群聊消息
    CREATE TABLE chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id TEXT UNIQUE NOT NULL,
      chat_id TEXT NOT NULL,
      sender_name TEXT,
      content_text TEXT,
      msg_type TEXT NOT NULL DEFAULT 'text',
      created_at TEXT NOT NULL
    );

    -- 用户记忆库
    CREATE TABLE user_memories (
      memory_id TEXT PRIMARY KEY,
      user_id   TEXT NOT NULL,
      title     TEXT NOT NULL,
      content   TEXT NOT NULL,
      tags_json TEXT NOT NULL DEFAULT '[]',
      scope     TEXT NOT NULL DEFAULT 'personal',
      pinned    INTEGER NOT NULL DEFAULT 0,
      embedding BLOB,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_memories_user ON user_memories(user_id);

    -- 权限策略
    CREATE TABLE policies (
      policy_id    TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      effect       TEXT NOT NULL DEFAULT 'allow',
      roles_json   TEXT NOT NULL,
      sensitivity  TEXT,
      actions_json TEXT NOT NULL DEFAULT '["read"]',
      priority     INTEGER NOT NULL DEFAULT 0,
      is_active    INTEGER NOT NULL DEFAULT 1
    );
  `);
}

// ─── Seed 数据 ─────────────────────────────────────────────────────────────

function seedData() {
  // 用户
  db.prepare("INSERT INTO users VALUES ('u_member', null, 'Member User', 'member', 1, datetime('now'), datetime('now'))").run();
  db.prepare("INSERT INTO users VALUES ('u_guest', null, 'Guest User', 'guest', 1, datetime('now'), datetime('now'))").run();

  // 策略：member 可读 internal；guest 可读 public
  db.prepare("INSERT INTO policies VALUES ('p_member', 'member read', 'allow', '[\"member\"]', 'internal', '[\"read\"]', 50, 1)").run();
  db.prepare("INSERT INTO policies VALUES ('p_guest', 'guest public', 'allow', '[\"guest\"]', 'public', '[\"read\"]', 30, 1)").run();

  // 数据对象
  const insertObj = db.prepare(`
    INSERT INTO objects (object_id, source, source_type, uri, title, sensitivity, acl_json, tags_json, connector_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'test')
  `);

  insertObj.run('o1', 'gitlab', 'merge_request', 'gitlab://mr/1', 'Fix login bug',       'internal',   '{"read":[]}', '[]');
  insertObj.run('o2', 'gitlab', 'merge_request', 'gitlab://mr/2', 'Add dark mode',       'internal',   '{"read":[]}', '[]');
  insertObj.run('o3', 'feishu', 'document',       'feishu://doc/1', 'Q1 Roadmap',         'internal',   '{"read":[]}', '[]');
  insertObj.run('o4', 'feishu', 'document',       'feishu://doc/2', 'Public Changelog',   'public',     '{"read":[]}', '[]');
  insertObj.run('o5', 'linear', 'issue',           'linear://issue/1', 'Product Backlog', 'restricted', '{"read":["role:member"]}', '[]');
}

// ─── 内联：searchObjects (简化版，仅支持 source/sensitivity 过滤) ──────────

function searchObjects(opts: { source?: string; source_type?: string; sensitivity?: string; limit?: number }): DataObject[] {
  let sql = 'SELECT * FROM objects WHERE 1=1';
  const params: unknown[] = [];
  if (opts.source) { sql += ' AND source = ?'; params.push(opts.source); }
  if (opts.source_type) { sql += ' AND source_type = ?'; params.push(opts.source_type); }
  if (opts.sensitivity) { sql += ' AND sensitivity = ?'; params.push(opts.sensitivity); }
  sql += ` LIMIT ${opts.limit ?? 20}`;

  return (db.prepare(sql).all(...params) as Record<string, unknown>[]).map(row => ({
    object_id: row['object_id'] as string,
    source: row['source'] as string,
    source_type: row['source_type'] as string,
    uri: row['uri'] as string,
    title: row['title'] as string,
    sensitivity: row['sensitivity'] as Sensitivity,
    acl: JSON.parse(row['acl_json'] as string),
    tags: JSON.parse(row['tags_json'] as string),
    summary: row['summary'] as string | undefined,
    content_path: row['content_path'] as string | undefined,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
    last_indexed_at: row['last_indexed_at'] as string,
    ttl_seconds: row['ttl_seconds'] as number,
    connector_id: row['connector_id'] as string,
  }));
}

// ─── 内联：getUserById ──────────────────────────────────────────────────────

function getUserById(user_id: string): User | null {
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(user_id) as { user_id: string; role: Role; name: string } | undefined;
  return row ? { user_id: row.user_id, role: row.role, name: row.name } : null;
}

// ─── 内联：filterByAccess ──────────────────────────────────────────────────

function checkACL(user: User, acl: ACL, action: string): boolean {
  const userGroupIds = (db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(user.user_id) as { group_id: string }[]).map(r => r.group_id);
  const matchesRef = (r: string) =>
    r === `user:${user.user_id}` || r === `role:${user.role}` || r === 'role:all_staff' ||
    (r.startsWith('group:') && userGroupIds.includes(r.slice(6)));
  if (action === 'read' && acl.read) { if (acl.read.some(matchesRef)) return true; }
  return false;
}

function filterByAccess(user: User, objects: DataObject[]): DataObject[] {
  return objects.filter(obj => {
    if (user.role === 'owner') return true;
    if (checkACL(user, obj.acl, 'read')) return true;
    const hasExplicit = obj.acl.read && obj.acl.read.length > 0;
    if (hasExplicit) return false;
    // 检查 policies
    interface PolicyRow { roles_json: string; sensitivity: string | null; actions_json: string; effect: string; }
    const policies = db.prepare('SELECT * FROM policies WHERE is_active = 1 ORDER BY priority DESC').all() as PolicyRow[];
    for (const p of policies) {
      const roles: string[] = JSON.parse(p.roles_json);
      const actions: string[] = JSON.parse(p.actions_json);
      if (!roles.includes(user.role)) continue;
      if (p.sensitivity && p.sensitivity !== obj.sensitivity) continue;
      if (!actions.includes('read')) continue;
      return p.effect === 'allow';
    }
    return false;
  });
}

// ─── 内联：memory CRUD ────────────────────────────────────────────────────

function createMemory(user_id: string, title: string, content: string, tags: string[] = []) {
  const memory_id = randomBytes(12).toString('hex');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO user_memories (memory_id, user_id, title, content, tags_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(memory_id, user_id, title, content, JSON.stringify(tags), now, now);
  return memory_id;
}

function getMemoryByTitle(user_id: string, title: string) {
  return db.prepare('SELECT * FROM user_memories WHERE user_id = ? AND title = ? LIMIT 1').get(user_id, title) as MemoryRow | undefined;
}

function updateMemoryContent(memory_id: string, user_id: string, content: string, tags?: string[]) {
  const existing = db.prepare('SELECT * FROM user_memories WHERE memory_id = ? AND user_id = ?').get(memory_id, user_id) as MemoryRow;
  const now = new Date().toISOString();
  db.prepare('UPDATE user_memories SET content = ?, tags_json = ?, updated_at = ? WHERE memory_id = ? AND user_id = ?')
    .run(content, JSON.stringify(tags ?? JSON.parse(existing.tags_json)), now, memory_id, user_id);
}

function listMemories(user_id: string, limit = 5) {
  return db.prepare('SELECT * FROM user_memories WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?').all(user_id, limit) as MemoryRow[];
}

function countMemories(user_id: string) {
  return (db.prepare('SELECT COUNT(*) as c FROM user_memories WHERE user_id = ?').get(user_id) as { c: number }).c;
}

// ─── 内联 write_memory 逻辑 ──────────────────────────────────────────────

function writeMemory(user_id: string, title: string, content: string, tags?: string[]): string {
  const match = getMemoryByTitle(user_id, title);
  if (match) {
    updateMemoryContent(match.memory_id, user_id, content, tags ?? JSON.parse(match.tags_json));
    return `已更新记忆「${title}」`;
  }
  createMemory(user_id, title, content, tags);
  return `已保存记忆「${title}」`;
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe('unit-tools: search_data 逻辑', () => {
  setupSchema();
  seedData();

  test('source=gitlab 过滤 → 只返回 gitlab 对象', () => {
    const user = getUserById('u_member')!;
    const raw = searchObjects({ source: 'gitlab' });
    const accessible = filterByAccess(user, raw);
    assert.ok(accessible.length > 0, '应有 gitlab 对象');
    assert.ok(accessible.every(o => o.source === 'gitlab'), '所有对象应来自 gitlab');
  });

  test('member 可访问 internal 对象（无显式 ACL）', () => {
    const user = getUserById('u_member')!;
    const raw = searchObjects({ sensitivity: 'internal' });
    const accessible = filterByAccess(user, raw);
    assert.ok(accessible.length > 0, 'member 应能访问 internal 对象');
  });

  test('guest 无法访问 internal 对象', () => {
    const user = getUserById('u_guest')!;
    const raw = searchObjects({ sensitivity: 'internal' });
    const accessible = filterByAccess(user, raw);
    assert.equal(accessible.length, 0, 'guest 不应能访问无显式 ACL 的 internal 对象');
  });

  test('guest 可访问 public 对象', () => {
    const user = getUserById('u_guest')!;
    const raw = searchObjects({ sensitivity: 'public' });
    const accessible = filterByAccess(user, raw);
    assert.equal(accessible.length, 1, 'guest 应能访问 public 对象');
    assert.equal(accessible[0].object_id, 'o4');
  });

  test('member 通过显式 ACL 访问 restricted 对象', () => {
    const user = getUserById('u_member')!;
    const raw = searchObjects({ sensitivity: 'restricted' });
    const accessible = filterByAccess(user, raw);
    // o5 的 acl.read 含 role:member
    assert.equal(accessible.length, 1);
    assert.equal(accessible[0].object_id, 'o5');
  });

  test('返回对象列表包含 uri / title 字段', () => {
    const user = getUserById('u_member')!;
    const raw = searchObjects({ source: 'gitlab', limit: 1 });
    const accessible = filterByAccess(user, raw);
    assert.ok(accessible.length > 0);
    const obj = accessible[0];
    assert.ok(obj.uri, 'uri 不应为空');
    assert.ok(obj.title, 'title 不应为空');
  });
});

describe('unit-tools: run_query 逻辑', () => {
  test('按 sensitivity=public 查询 → 只返回 public 对象', () => {
    const user = getUserById('u_guest')!;
    const raw = searchObjects({ sensitivity: 'public' });
    const accessible = filterByAccess(user, raw);
    assert.ok(accessible.every(o => o.sensitivity === 'public'));
  });

  test('结构化表格包含必要列（来源/类型/标题/敏感级别）', () => {
    const user = getUserById('u_member')!;
    const raw = searchObjects({ source: 'gitlab' });
    const accessible = filterByAccess(user, raw);
    // 模拟 executeStructured 构建的表格行
    const columns = ['来源', '类型', '标题', '敏感级别', '更新时间', 'URI'];
    const rows = accessible.map(obj => ({
      '来源': obj.source,
      '类型': obj.source_type,
      '标题': obj.title,
      '敏感级别': obj.sensitivity,
      '更新时间': obj.updated_at?.slice(0, 10) ?? '未知',
      'URI': obj.uri,
    }));
    for (const col of columns) {
      assert.ok(rows.every(r => col in r), `每行应包含列「${col}」`);
    }
  });
});

describe('unit-tools: write_memory 逻辑', () => {
  const uid = 'u_write_test';

  test('新标题 → 新建记忆，返回"已保存"', () => {
    const msg = writeMemory(uid, 'Tech Stack', 'SQLite + Express');
    assert.ok(msg.includes('已保存'), `返回应包含"已保存"，实际：${msg}`);
    assert.equal(countMemories(uid), 1);
  });

  test('同标题 → 更新不新建，返回"已更新"', () => {
    const msg = writeMemory(uid, 'Tech Stack', 'SQLite + Express + TypeScript');
    assert.ok(msg.includes('已更新'), `返回应包含"已更新"，实际：${msg}`);
    assert.equal(countMemories(uid), 1, '行数仍为 1，没有新建');

    const row = getMemoryByTitle(uid, 'Tech Stack');
    assert.equal(row?.content, 'SQLite + Express + TypeScript', '内容应已更新');
  });

  test('不同标题 → 各自独立新建', () => {
    writeMemory(uid, 'Deploy Plan', 'Mac mini + PM2');
    assert.equal(countMemories(uid), 2, '不同标题应新建第二条');
  });

  test('tags 在更新时保留或覆盖', () => {
    const uid2 = 'u_tag_test';
    writeMemory(uid2, 'With Tags', 'content 1', ['tech', 'infra']);
    writeMemory(uid2, 'With Tags', 'content 2', ['updated-tag']);

    const row = getMemoryByTitle(uid2, 'With Tags')!;
    const tags = JSON.parse(row.tags_json);
    assert.deepEqual(tags, ['updated-tag'], 'tags 应在更新时覆盖');
  });
});

describe('unit-tools: read_memory 逻辑（无 embedding 降级）', () => {
  const uid = 'u_read_test';

  test('有记忆时 listUserMemories 返回结果', () => {
    createMemory(uid, 'My Preference', 'I prefer dark mode', ['preference']);
    createMemory(uid, 'My Tool', 'Use Telegram', ['tool']);

    const rows = listMemories(uid);
    assert.equal(rows.length, 2);
  });

  test('无 embedding → 确认降级路径（无 embedding 字段）', () => {
    const rows = listMemories(uid);
    for (const row of rows) {
      assert.equal(row.embedding, null, '未计算 embedding 时字段应为 null');
    }
  });

  test('无记忆时返回空数组', () => {
    const rows = listMemories('u_empty_user');
    assert.equal(rows.length, 0);
  });

  test('limit 生效', () => {
    const uid3 = 'u_limit_test';
    for (let i = 0; i < 8; i++) createMemory(uid3, `Memory${i}`, `Content ${i}`);
    const rows = listMemories(uid3, 5);
    assert.equal(rows.length, 5);
  });
});

console.log('\n✅ unit-tools 测试已注册，执行中...\n');
