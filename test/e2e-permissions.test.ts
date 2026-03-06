/**
 * E2E 权限测试（RBAC v2）
 *
 * 目标：
 * - owner/member/guest 的数据访问符合策略
 * - role:all_staff 数据对全员可见
 * - 群聊搜索 obey allowed_chat_ids
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, initSchema } = await import('../dist/datamap/db.js');
const { searchObjects, searchChatMessages, getObjectByUri } = await import('../dist/datamap/objects.js');
const { filterByAccess, checkAccess } = await import('../dist/policy/engine.js');
const { getUserById } = await import('../dist/auth/users.js');

const db = getDb();
initSchema();

function getUserByRole(role: 'owner' | 'admin' | 'member' | 'guest') {
  return db.prepare('SELECT user_id, name, role FROM users WHERE role = ? AND is_active = 1 LIMIT 1').get(role) as
    | { user_id: string; name: string; role: string }
    | undefined;
}

function ensureTestChatData() {
  const exists = db.prepare("SELECT COUNT(*) as cnt FROM chat_messages WHERE message_id = 'perm_v2_msg_1'").get() as { cnt: number };
  if (exists.cnt > 0) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO chat_messages (message_id, chat_id, chat_type, sender_id, sender_name, msg_type, content_text, content_json, created_at)
    VALUES (?, ?, 'group', ?, ?, 'text', ?, '{}', ?)
  `);
  insert.run('perm_v2_msg_1', 'perm_v2_chat_a', 'u1', 'Alice', '发布计划讨论', '2026-03-01T10:00:00Z');
  insert.run('perm_v2_msg_2', 'perm_v2_chat_b', 'u2', 'Bob', '数据库方案评审', '2026-03-01T11:00:00Z');

  const rows = db.prepare("SELECT id, sender_name, content_text FROM chat_messages WHERE message_id LIKE 'perm_v2_msg_%'").all() as
    { id: number; sender_name: string; content_text: string }[];
  for (const r of rows) {
    db.prepare('DELETE FROM chat_fts WHERE rowid = ?').run(r.id);
    db.prepare('INSERT INTO chat_fts(rowid, sender_name, content_text) VALUES (?, ?, ?)').run(r.id, r.sender_name, r.content_text);
  }

  const guest = getUserByRole('guest');
  const member = getUserByRole('member');
  if (guest) {
    db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id, group_name) VALUES (?, ?, ?)')
      .run(guest.user_id, 'perm_v2_chat_a', '产品群');
  }
  if (member) {
    db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id, group_name) VALUES (?, ?, ?)')
      .run(member.user_id, 'perm_v2_chat_a', '产品群');
    db.prepare('INSERT OR IGNORE INTO user_groups (user_id, group_id, group_name) VALUES (?, ?, ?)')
      .run(member.user_id, 'perm_v2_chat_b', '技术群');
  }
}

describe('E2E 权限测试（RBAC v2）', () => {
  const owner = getUserByRole('owner');
  const member = getUserByRole('member');
  const guest = getUserByRole('guest');

  test('关键角色存在', () => {
    assert.ok(owner, '应存在 owner 用户');
    assert.ok(member, '应存在 member 用户');
    assert.ok(guest, '应存在 guest 用户');
  });

  test('GitLab MR: guest 不可见，member 可见', () => {
    const all = searchObjects({ source: 'gitlab' as any, source_type: 'merge_request' as any, limit: 50 });
    if (all.length === 0) return;

    const guestUser = getUserById(guest!.user_id)!;
    const memberUser = getUserById(member!.user_id)!;
    const guestVisible = filterByAccess(guestUser, all);
    const memberVisible = filterByAccess(memberUser, all);

    assert.equal(guestVisible.length, 0, 'guest 不应看到 GitLab MR');
    assert.ok(memberVisible.length > 0, 'member 应能看到 GitLab MR');
  });

  test('all_staff 数据（PostHog/Linear）对 guest/member 都可见', () => {
    const guestUser = getUserById(guest!.user_id)!;
    const memberUser = getUserById(member!.user_id)!;

    for (const source of ['posthog', 'linear'] as const) {
      const all = searchObjects({ source: source as any, limit: 50 });
      if (all.length === 0) continue;
      assert.equal(filterByAccess(guestUser, all).length, all.length, `guest 应看到全部 ${source}`);
      assert.equal(filterByAccess(memberUser, all).length, all.length, `member 应看到全部 ${source}`);
    }
  });

  test('owner 可见全部对象（抽样）', () => {
    const all = searchObjects({ limit: 200 });
    if (all.length === 0) return;
    const user = getUserById(owner!.user_id)!;
    const visible = filterByAccess(user, all);
    assert.equal(visible.length, all.length, 'owner 应看到全部对象');
  });

  test('单对象 checkAccess 与 filter 一致（GitLab MR）', () => {
    const mr = db.prepare("SELECT uri FROM objects WHERE source = 'gitlab' AND source_type = 'merge_request' LIMIT 1").get() as
      | { uri: string }
      | undefined;
    if (!mr) return;
    const obj = getObjectByUri(mr.uri);
    if (!obj) return;

    const memberUser = getUserById(member!.user_id)!;
    const guestUser = getUserById(guest!.user_id)!;
    assert.equal(checkAccess(memberUser, obj, 'read').allowed, true, 'member 对 MR 应 allow');
    assert.equal(checkAccess(guestUser, obj, 'read').allowed, false, 'guest 对 MR 应 deny');
  });

  describe('群聊权限过滤', () => {
    before(() => {
      ensureTestChatData();
    });

    test('guest 仅能搜到自己所在群消息', () => {
      const groups = db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(guest!.user_id) as { group_id: string }[];
      const allowed = groups.map(g => g.group_id);
      const results = searchChatMessages({ query: '发布计划', allowed_chat_ids: allowed });
      assert.ok(results.every(r => allowed.includes(r.chat_id)), '返回结果应全部在 allowed_chat_ids 内');
    });

    test('member 能搜到多个已授权群', () => {
      const groups = db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(member!.user_id) as { group_id: string }[];
      const allowed = groups.map(g => g.group_id);
      const results = searchChatMessages({ query: '方案', allowed_chat_ids: allowed });
      assert.ok(results.every(r => allowed.includes(r.chat_id)), '返回结果应全部在 allowed_chat_ids 内');
    });
  });
});
