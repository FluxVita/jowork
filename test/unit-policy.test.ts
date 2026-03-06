/**
 * unit-policy.test.ts
 * RBAC/ABAC 权限引擎单元测试 — 内联逻辑 + 内存 SQLite
 *
 * 验证：
 * 1. filterByAccess: guest → 看不到 sensitivity=restricted 的对象
 * 2. filterByAccess: member → 可看到 acl_json 含 role:member 的对象
 * 3. checkAccess: acl_json 含 group:xxx → 用户在群时 pass，不在群时 deny
 *
 * 运行：npx tsx test/unit-policy.test.ts
 */

import Database from 'better-sqlite3';
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ─── 类型 ─────────────────────────────────────────────────────────────────

type Role = 'owner' | 'admin' | 'member' | 'guest';
type Sensitivity = 'public' | 'internal' | 'restricted' | 'secret';
type AccessLevel = 'admin' | 'edit' | 'read' | 'none';

interface ACL { read: string[]; write?: string[]; admin?: string[]; }
interface User { user_id: string; role: Role; feishu_open_id: string; name: string; email?: string; is_active: boolean; created_at: string; updated_at: string; }
interface DataObject { object_id: string; source: string; source_type: string; uri: string; title: string; sensitivity: Sensitivity; acl: ACL; tags: string[]; created_at: string; updated_at: string; last_indexed_at: string; ttl_seconds: number; connector_id: string; }

// ─── 内存 DB ─────────────────────────────────────────────────────────────

let testDb: InstanceType<typeof Database>;

function setupSchema() {
  testDb = new Database(':memory:');
  testDb.exec(`
    CREATE TABLE policies (
      policy_id    TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      effect       TEXT NOT NULL DEFAULT 'allow',
      roles_json   TEXT NOT NULL,
      sensitivity  TEXT,
      actions_json TEXT NOT NULL DEFAULT '["read"]',
      conditions_json TEXT,
      priority     INTEGER NOT NULL DEFAULT 0,
      is_active    INTEGER NOT NULL DEFAULT 1,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE user_groups (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    TEXT NOT NULL,
      group_id   TEXT NOT NULL,
      group_name TEXT,
      synced_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(user_id, group_id)
    );
  `);

  // 插入基础 RBAC 策略（模拟 seed 中的默认策略）
  testDb.prepare(`INSERT INTO policies (policy_id, name, effect, roles_json, sensitivity, actions_json, priority) VALUES
    ('p_owner', 'owner all', 'allow', '["owner"]', null, '["read","write","admin"]', 100)
  `).run();

  testDb.prepare(`INSERT INTO policies (policy_id, name, effect, roles_json, sensitivity, actions_json, priority) VALUES
    ('p_admin', 'admin all', 'allow', '["admin"]', null, '["read","write","admin"]', 90)
  `).run();

  testDb.prepare(`INSERT INTO policies (policy_id, name, effect, roles_json, sensitivity, actions_json, priority) VALUES
    ('p_member_read', 'member read internal', 'allow', '["member"]', 'internal', '["read"]', 50)
  `).run();

  testDb.prepare(`INSERT INTO policies (policy_id, name, effect, roles_json, sensitivity, actions_json, priority) VALUES
    ('p_guest_public', 'guest read public', 'allow', '["guest"]', 'public', '["read"]', 30)
  `).run();
}

// ─── 内联权限引擎逻辑（与 policy/engine.ts 保持逻辑一致） ─────────────────

function checkACL(user: User, acl: ACL, action: string): { allowed: boolean; level: AccessLevel; matched_rule?: string } {
  const userRef = `user:${user.user_id}`;
  const roleRef = `role:${user.role}`;
  const allRef = 'role:all_staff';

  const userGroupIds = (testDb.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(user.user_id) as { group_id: string }[]).map(r => r.group_id);
  const matchesRef = (r: string) => r === userRef || r === roleRef || r === allRef || (r.startsWith('group:') && userGroupIds.includes(r.slice(6)));

  if (action === 'admin' && acl.admin) { if (acl.admin.some(matchesRef)) return { allowed: true, level: 'admin', matched_rule: 'acl_admin' }; }
  if ((action === 'write' || action === 'edit') && acl.write) { if (acl.write.some(matchesRef)) return { allowed: true, level: 'edit', matched_rule: 'acl_write' }; }
  if (action === 'read' && acl.read) { if (acl.read.some(matchesRef)) return { allowed: true, level: 'read', matched_rule: 'acl_read' }; }

  return { allowed: false, level: 'none' };
}

function checkAccess(user: User, object: DataObject, action: string): { allowed: boolean; level: AccessLevel; matched_rule?: string } {
  if (user.role === 'owner') return { allowed: true, level: 'admin', matched_rule: 'owner_override' };

  const aclResult = checkACL(user, object.acl, action);
  if (aclResult.allowed) return aclResult;

  const hasExplicitACL = (action === 'read' && object.acl.read && object.acl.read.length > 0)
    || (action === 'write' && object.acl.write && object.acl.write.length > 0)
    || (action === 'admin' && object.acl.admin && object.acl.admin.length > 0);

  if (hasExplicitACL) return { allowed: false, level: 'none', matched_rule: 'acl_explicit_deny' };

  // 无 ACL → 检查 policies
  interface PolicyRow { policy_id: string; effect: string; roles_json: string; sensitivity: string | null; actions_json: string; priority: number; }
  const policies = testDb.prepare('SELECT * FROM policies WHERE is_active = 1 ORDER BY priority DESC').all() as PolicyRow[];
  for (const policy of policies) {
    const roles: string[] = JSON.parse(policy.roles_json);
    const actions: string[] = JSON.parse(policy.actions_json);
    if (!roles.includes(user.role)) continue;
    if (policy.sensitivity && policy.sensitivity !== object.sensitivity) continue;
    if (!actions.includes(action)) continue;
    if (policy.effect === 'allow') {
      const level = actions.includes('admin') ? 'admin' : actions.includes('write') ? 'edit' : 'read';
      return { allowed: true, level, matched_rule: policy.policy_id };
    } else {
      return { allowed: false, level: 'none', matched_rule: policy.policy_id };
    }
  }

  return { allowed: false, level: 'none', matched_rule: 'default_deny' };
}

function filterByAccess(user: User, objects: DataObject[]): DataObject[] {
  return objects.filter(obj => checkAccess(user, obj, 'read').allowed);
}

// ─── 辅助：构造 User / DataObject ────────────────────────────────────────

function makeUser(role: Role, user_id = `u_${role}`): User {
  return { user_id, role, feishu_open_id: `fid_${user_id}`, name: role, is_active: true, created_at: '', updated_at: '' };
}

function makeObject(id: string, sensitivity: Sensitivity, acl: ACL): DataObject {
  return {
    object_id: id, source: 'gitlab', source_type: 'merge_request', uri: `uri:${id}`,
    title: `Object ${id}`, sensitivity, acl, tags: [], created_at: '', updated_at: '',
    last_indexed_at: '', ttl_seconds: 900, connector_id: 'gitlab_v1',
  };
}

// ─── 测试 ─────────────────────────────────────────────────────────────────

describe('unit-policy: filterByAccess', () => {
  setupSchema();

  test('guest 看不到 sensitivity=restricted 对象（无 ACL）', () => {
    const guest = makeUser('guest');
    const objs = [
      makeObject('pub', 'public', { read: [] }),      // 无显式 ACL → 走 policies
      makeObject('int', 'internal', { read: [] }),    // 无显式 ACL → 走 policies
      makeObject('res', 'restricted', { read: [] }),  // 无显式 ACL → 走 policies
    ];
    const visible = filterByAccess(guest, objs);
    const ids = visible.map(o => o.object_id);
    assert.ok(ids.includes('pub'), 'guest 应能看到 public 对象');
    assert.ok(!ids.includes('int'), 'guest 无 internal 策略，不应看到');
    assert.ok(!ids.includes('res'), 'guest 不应看到 restricted 对象');
  });

  test('member 可看到 acl_json 含 role:member 的对象（显式 ACL）', () => {
    const member = makeUser('member');
    const obj = makeObject('member-obj', 'restricted', { read: ['role:member'] });
    const visible = filterByAccess(member, [obj]);
    assert.equal(visible.length, 1, 'member 应能通过显式 ACL 访问');
    assert.equal(visible[0].object_id, 'member-obj');
  });

  test('guest 无法访问 member ACL 对象', () => {
    const guest = makeUser('guest');
    const obj = makeObject('member-only', 'restricted', { read: ['role:member'] });
    const visible = filterByAccess(guest, [obj]);
    assert.equal(visible.length, 0, 'guest 不在 ACL 中，应被拒绝');
  });

  test('owner 总是能看到所有对象', () => {
    const owner = makeUser('owner');
    const objs = [
      makeObject('s1', 'secret', { read: ['user:nobody'] }),
      makeObject('s2', 'restricted', { read: [] }),
    ];
    const visible = filterByAccess(owner, objs);
    assert.equal(visible.length, 2, 'owner 应看到所有对象');
  });
});

describe('unit-policy: checkAccess 群组权限', () => {
  test('acl 含 group:xxx → 用户在群时 pass', () => {
    testDb.prepare("INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES ('u_grp', 'grp_eng')").run();
    const user = makeUser('guest', 'u_grp');
    const obj = makeObject('grp-obj', 'internal', { read: ['group:grp_eng'] });
    const result = checkAccess(user, obj, 'read');
    assert.equal(result.allowed, true, '用户在群 grp_eng，应通过');
    assert.equal(result.matched_rule, 'acl_read');
  });

  test('acl 含 group:xxx → 用户不在群时 deny', () => {
    // u_nogrp 不在 grp_eng 中
    const user = makeUser('guest', 'u_nogrp');
    const obj = makeObject('grp-obj2', 'internal', { read: ['group:grp_eng'] });
    const result = checkAccess(user, obj, 'read');
    assert.equal(result.allowed, false, '用户不在群，应被拒绝');
    assert.equal(result.matched_rule, 'acl_explicit_deny');
  });

  test('acl 含 role:all_staff → 所有角色都能访问', () => {
    const guest = makeUser('guest', 'u_staff');
    const obj = makeObject('all-staff', 'internal', { read: ['role:all_staff'] });
    const result = checkAccess(guest, obj, 'read');
    assert.equal(result.allowed, true, 'role:all_staff 应匹配所有用户');
  });

  test('acl 含 user:specific → 精确匹配用户', () => {
    const user = makeUser('guest', 'specific_user');
    const obj = makeObject('specific-obj', 'internal', { read: ['user:specific_user'] });
    const result = checkAccess(user, obj, 'read');
    assert.equal(result.allowed, true, '精确用户 ID 应通过');
  });

  test('acl 含 user:specific → 其他用户被拒', () => {
    const other = makeUser('member', 'other_user');
    const obj = makeObject('specific-obj2', 'internal', { read: ['user:specific_user'] });
    const result = checkAccess(other, obj, 'read');
    assert.equal(result.allowed, false, '非目标用户应被拒绝');
  });
});

console.log('\n✅ unit-policy 测试已注册，执行中...\n');
