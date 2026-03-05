import { getDb } from '../datamap/db.js';
import { listServices } from './registry.js';
import type { Service, User } from '../types.js';

export interface ResolvedService extends Service {
  grant_source: string;
}

/**
 * 解析用户可用的服务列表。
 *
 * 优先级：
 * 1. owner → 全部 active 服务
 * 2. default_roles 包含 user.role
 * 3. service_grants (role 级)
 * 4. service_grants (user 级)
 * 5. service_grants (group 级, 联查 user_groups)
 *
 * 过滤掉 expires_at 已过期的 grants，去重返回。
 */
export function resolveServicesForUser(user: User): ResolvedService[] {
  const allActive = listServices({ status: 'active' });

  // owner 全部可用
  if (user.role === 'owner') {
    return allActive.map(s => ({ ...s, grant_source: 'owner' }));
  }

  const db = getDb();
  const now = new Date().toISOString();
  const resolved = new Map<string, ResolvedService>();

  // 获取用户所在群组
  const userGroupIds = (db.prepare('SELECT group_id FROM user_groups WHERE user_id = ?').all(user.user_id) as { group_id: string }[])
    .map(r => r.group_id);

  for (const svc of allActive) {
    // default_roles 包含用户角色
    if (svc.default_roles.includes(user.role)) {
      resolved.set(svc.service_id, { ...svc, grant_source: 'role_default' });
      continue;
    }

    // 检查 grants
    const grants = db.prepare(
      'SELECT * FROM service_grants WHERE service_id = ? AND (expires_at IS NULL OR expires_at > ?)'
    ).all(svc.service_id, now) as {
      grant_id: string; service_id: string; grant_type: string;
      grant_target: string; granted_by: string; expires_at: string | null; created_at: string;
    }[];

    for (const g of grants) {
      if (resolved.has(svc.service_id)) break;

      if (g.grant_type === 'role' && g.grant_target === user.role) {
        resolved.set(svc.service_id, { ...svc, grant_source: `grant:role:${user.role}` });
      } else if (g.grant_type === 'user' && g.grant_target === user.user_id) {
        resolved.set(svc.service_id, { ...svc, grant_source: `grant:user:${user.user_id}` });
      } else if (g.grant_type === 'group' && userGroupIds.includes(g.grant_target)) {
        resolved.set(svc.service_id, { ...svc, grant_source: `grant:group:${g.grant_target}` });
      }
    }

    // 对 data_scope='group' 的服务，检查 group_source_bindings（按 source_type 匹配）
    if (!resolved.has(svc.service_id) && svc.data_scope === 'group') {
      const sourceType = svc.service_id === 'svc_feishu' ? 'feishu_chat'
        : svc.service_id === 'svc_email' ? 'email_account'
        : null;
      if (sourceType) {
        const binding = db.prepare(`
          SELECT 1 FROM group_source_bindings gsb
          JOIN user_groups ug ON ug.group_id = gsb.group_id
          WHERE gsb.source_type = ? AND ug.user_id = ?
          LIMIT 1
        `).get(sourceType, user.user_id);
        if (binding) {
          resolved.set(svc.service_id, { ...svc, grant_source: 'group_binding' });
        }
      }
    }
  }

  return Array.from(resolved.values());
}
