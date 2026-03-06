/**
 * E2E 真实数据权限测试（RBAC v2）
 *
 * 说明：
 * - 不再硬编码旧角色或固定姓名
 * - 直接基于当前生产库中的 active users 做抽样验证
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, initSchema } = await import('../dist/datamap/db.js');
const { searchObjects, searchChatMessages, getObjectByUri } = await import('../dist/datamap/objects.js');
const { filterByAccess, checkAccess } = await import('../dist/policy/engine.js');
const { getUserById } = await import('../dist/auth/users.js');

const db = getDb();
initSchema();

type Role = 'owner' | 'admin' | 'member' | 'guest';

function pickUser(role: Role) {
  return db.prepare('SELECT user_id, name, role FROM users WHERE role = ? AND is_active = 1 LIMIT 1').get(role) as
    | { user_id: string; name: string; role: Role }
    | undefined;
}

function countByRole(role: Role): number {
  const row = db.prepare('SELECT COUNT(*) as n FROM users WHERE role = ? AND is_active = 1').get(role) as { n: number };
  return row.n;
}

describe('真实用户角色分布（RBAC v2）', () => {
  test('存在 owner/member/guest 角色用户', () => {
    assert.ok(countByRole('owner') > 0, '应至少有一个 owner');
    assert.ok(countByRole('member') > 0, '应至少有一个 member');
    assert.ok(countByRole('guest') > 0, '应至少有一个 guest');
  });
});

describe('真实数据权限矩阵（GitLab）', () => {
  const owner = pickUser('owner');
  const member = pickUser('member');
  const guest = pickUser('guest');

  test('基线：存在 GitLab MR 或 Repo 数据', () => {
    const mrs = searchObjects({ source: 'gitlab' as any, source_type: 'merge_request' as any, limit: 5 });
    const repos = searchObjects({ source: 'gitlab' as any, source_type: 'repository' as any, limit: 5 });
    assert.ok(mrs.length > 0 || repos.length > 0, '应至少存在 GitLab MR 或 Repo 数据');
  });

  test('guest 对 GitLab MR 不可见（若存在）', () => {
    const all = searchObjects({ source: 'gitlab' as any, source_type: 'merge_request' as any, limit: 100 });
    if (all.length === 0) return;
    const user = getUserById(guest!.user_id)!;
    const visible = filterByAccess(user, all);
    assert.equal(visible.length, 0, 'guest 不应看到 GitLab MR');
  });

  test('member 对 GitLab MR 可见（若存在）', () => {
    const all = searchObjects({ source: 'gitlab' as any, source_type: 'merge_request' as any, limit: 100 });
    if (all.length === 0) return;
    const user = getUserById(member!.user_id)!;
    const visible = filterByAccess(user, all);
    assert.ok(visible.length > 0, 'member 应能看到 GitLab MR');
  });

  test('owner 对 GitLab 对象可见（若存在）', () => {
    const all = searchObjects({ source: 'gitlab' as any, limit: 200 });
    if (all.length === 0) return;
    const user = getUserById(owner!.user_id)!;
    const visible = filterByAccess(user, all);
    assert.equal(visible.length, all.length, 'owner 应看到全部 GitLab 对象');
  });
});

describe('真实数据权限矩阵（PostHog / Linear all_staff）', () => {
  const member = pickUser('member');
  const guest = pickUser('guest');

  test('guest/member 均可读 all_staff 源', () => {
    const guestUser = getUserById(guest!.user_id)!;
    const memberUser = getUserById(member!.user_id)!;
    for (const src of ['posthog', 'linear'] as const) {
      const all = searchObjects({ source: src as any, limit: 100 });
      if (all.length === 0) continue;
      assert.equal(filterByAccess(guestUser, all).length, all.length, `guest 应看到全部 ${src}`);
      assert.equal(filterByAccess(memberUser, all).length, all.length, `member 应看到全部 ${src}`);
    }
  });
});

describe('单对象权限校验', () => {
  const member = pickUser('member');
  const guest = pickUser('guest');

  test('GitLab MR: member allow, guest deny', () => {
    const row = db.prepare("SELECT uri FROM objects WHERE source = 'gitlab' AND source_type = 'merge_request' LIMIT 1").get() as
      | { uri: string }
      | undefined;
    if (!row) return;
    const obj = getObjectByUri(row.uri);
    if (!obj) return;

    const memberAccess = checkAccess(getUserById(member!.user_id)!, obj, 'read');
    const guestAccess = checkAccess(getUserById(guest!.user_id)!, obj, 'read');
    assert.equal(memberAccess.allowed, true, 'member 对 GitLab MR 应 allow');
    assert.equal(guestAccess.allowed, false, 'guest 对 GitLab MR 应 deny');
  });
});

describe('群聊权限泄露扫描', () => {
  const guest = pickUser('guest');
  const member = pickUser('member');

  test('搜索结果应始终受 allowed_chat_ids 限制', () => {
    for (const user of [guest!, member!]) {
      const groups = db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(user.user_id) as { group_id: string }[];
      const allowed = groups.map(g => g.group_id);
      const results = searchChatMessages({ query: '发布', allowed_chat_ids: allowed });
      assert.ok(results.every(r => allowed.includes(r.chat_id)), `${user.role} 结果不应越权`);
    }
  });
});
