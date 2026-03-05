import { getDb } from '../datamap/db.js';
import type { Role, Sensitivity, AccessLevel, DataObject, User, ACL } from '../types.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('policy');

interface PolicyRow {
  policy_id: string;
  effect: string;
  roles_json: string;
  sensitivity: string | null;
  actions_json: string;
  priority: number;
}

/** 默认拒绝：检查用户对某数据对象的访问权限 */
export function checkAccess(user: User, object: DataObject, action: string): {
  allowed: boolean;
  level: AccessLevel;
  matched_rule?: string;
} {
  // owner 总是 admin 权限
  if (user.role === 'owner') {
    return { allowed: true, level: 'admin', matched_rule: 'owner_override' };
  }

  // 先检查对象级 ACL
  const aclResult = checkACL(user, object.acl, action);
  if (aclResult.allowed) {
    return aclResult;
  }

  // 如果对象有明确的 ACL 且用户不在 ACL 中 → ACL 是最终裁决，不 fallback 到 policies
  // policies 表只用于没有设置 ACL 的对象（作为默认策略）
  const hasExplicitACL = (action === 'read' && object.acl.read && object.acl.read.length > 0)
    || (action === 'write' && object.acl.write && object.acl.write.length > 0)
    || (action === 'admin' && object.acl.admin && object.acl.admin.length > 0);

  if (hasExplicitACL) {
    log.warn('Access denied (ACL explicit deny)', {
      user: user.user_id,
      role: user.role,
      object: object.object_id,
      action,
    });
    return { allowed: false, level: 'none', matched_rule: 'acl_explicit_deny' };
  }

  // 无 ACL 的对象 → 检查策略表（作为默认策略）
  const db = getDb();
  const policies = db.prepare(
    'SELECT * FROM policies WHERE is_active = 1 ORDER BY priority DESC'
  ).all() as PolicyRow[];

  for (const policy of policies) {
    const roles: string[] = JSON.parse(policy.roles_json);
    const actions: string[] = JSON.parse(policy.actions_json);

    // 角色匹配
    if (!roles.includes(user.role)) continue;

    // 敏感级别匹配（null = 匹配所有级别）
    if (policy.sensitivity && policy.sensitivity !== object.sensitivity) continue;

    // 操作匹配
    if (!actions.includes(action)) continue;

    if (policy.effect === 'allow') {
      const level = actions.includes('admin') ? 'admin'
        : actions.includes('write') ? 'edit'
        : 'read';
      return { allowed: true, level, matched_rule: policy.policy_id };
    } else {
      return { allowed: false, level: 'none', matched_rule: policy.policy_id };
    }
  }

  // 默认拒绝
  log.warn('Access denied (default deny)', {
    user: user.user_id,
    role: user.role,
    object: object.object_id,
    sensitivity: object.sensitivity,
    action,
  });
  return { allowed: false, level: 'none', matched_rule: 'default_deny' };
}

/** 检查对象级 ACL */
function checkACL(user: User, acl: ACL, action: string): {
  allowed: boolean;
  level: AccessLevel;
  matched_rule?: string;
} {
  const userRef = `user:${user.user_id}`;
  const roleRef = `role:${user.role}`;
  const allRef = 'role:all_staff';

  // 获取用户所在群组（用于 group:xxx 匹配）
  const db = getDb();
  const userGroupIds = (db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?')
    .all(user.user_id) as { group_id: string }[]).map(r => r.group_id);

  const matchesRef = (r: string) =>
    r === userRef || r === roleRef || r === allRef ||
    (r.startsWith('group:') && userGroupIds.includes(r.slice(6)));

  // admin 级别
  if (action === 'admin' && acl.admin) {
    if (acl.admin.some(matchesRef)) {
      return { allowed: true, level: 'admin', matched_rule: 'acl_admin' };
    }
  }

  // write 级别
  if ((action === 'write' || action === 'edit') && acl.write) {
    if (acl.write.some(matchesRef)) {
      return { allowed: true, level: 'edit', matched_rule: 'acl_write' };
    }
  }

  // read 级别
  if (action === 'read' && acl.read) {
    if (acl.read.some(matchesRef)) {
      return { allowed: true, level: 'read', matched_rule: 'acl_read' };
    }
  }

  return { allowed: false, level: 'none' };
}

/** 按权限过滤对象列表（不可见的对象直接移除） */
export function filterByAccess(user: User, objects: DataObject[]): DataObject[] {
  return objects.filter(obj => {
    const result = checkAccess(user, obj, 'read');
    return result.allowed;
  });
}

/** 检查是否允许本地下沉 */
export function canDownload(sensitivity: Sensitivity): boolean {
  return sensitivity === 'public' || sensitivity === 'internal';
}
