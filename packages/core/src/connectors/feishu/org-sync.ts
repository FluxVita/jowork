import { feishuApi } from './auth.js';
import { getDb } from '../../datamap/db.js';
import { trackApiCall, canCallFeishu } from '../../quota/manager.js';
import { getCursor, setCursor } from '../sync-state.js';
import { createLogger } from '../../utils/logger.js';
import type { Role } from '../../types.js';

const log = createLogger('feishu-org-sync');

// ─── 飞书响应类型 ───

interface FeishuDepartment {
  open_department_id: string;
  name: string;
  parent_department_id: string;
  leader_user_id?: string;
  member_count?: number;
}

interface FeishuUser {
  open_id: string;
  name: string;
  email?: string;
  mobile?: string;
  avatar?: { avatar_72?: string };
  department_ids?: string[];
  job_title?: string;
  status?: { is_activated?: boolean; is_resigned?: boolean };
}

interface FeishuListResp<T> {
  code: number;
  msg: string;
  data: {
    items: T[];
    has_more: boolean;
    page_token?: string;
  };
}

interface RoleMapping {
  match_type: 'department_name' | 'job_title' | 'open_id';
  match_value: string;
  gateway_role: Role;
  priority: number;
}

// ─── Schema ───

function ensureTables() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS feishu_role_mappings (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      match_type  TEXT NOT NULL DEFAULT 'department_name',
      match_value TEXT NOT NULL,
      gateway_role TEXT NOT NULL,
      priority    INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT DEFAULT (datetime('now')),
      UNIQUE(match_type, match_value)
    )
  `);

  // users 表加 role_locked 字段
  try {
    db.exec(`ALTER TABLE users ADD COLUMN role_locked INTEGER NOT NULL DEFAULT 0`);
    log.info('Migration: added role_locked to users');
  } catch { /* 列已存在 */ }
}

// ─── 默认映射 ───

function seedDefaultMappings() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as n FROM feishu_role_mappings').get() as { n: number };
  if (count.n > 0) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO feishu_role_mappings (match_type, match_value, gateway_role, priority)
    VALUES (?, ?, ?, ?)
  `);

  const seed = db.transaction(() => {
    // 职位匹配（高优先级）
    insert.run('job_title', 'CEO', 'owner', 100);
    insert.run('job_title', 'CTO', 'owner', 100);
    insert.run('job_title', 'COO', 'admin', 90);
    insert.run('job_title', 'VP', 'admin', 90);

    // 部门匹配（中优先级）— 全部映射到 member
    insert.run('department_name', '技术', 'member', 50);
    insert.run('department_name', '研发', 'member', 50);
    insert.run('department_name', '工程', 'member', 50);
    insert.run('department_name', '产品', 'member', 50);
    insert.run('department_name', '设计', 'member', 50);
    insert.run('department_name', '运营', 'member', 50);
    insert.run('department_name', '市场', 'member', 50);
  });

  seed();

  // 迁移旧角色名到新角色名
  db.exec(`
    UPDATE feishu_role_mappings SET gateway_role = 'owner'  WHERE gateway_role = 'super_admin';
    UPDATE feishu_role_mappings SET gateway_role = 'member' WHERE gateway_role IN ('developer','product','operations','designer');
    UPDATE feishu_role_mappings SET gateway_role = 'guest'  WHERE gateway_role = 'viewer';
  `);

  log.info('Default role mappings seeded');
}

// ─── API 拉取 ───

/** 递归拉取所有部门 */
async function fetchAllDepartments(): Promise<Map<string, string>> {
  const deptMap = new Map<string, string>(); // open_department_id → name
  let pageToken: string | undefined;

  do {
    if (!canCallFeishu('user_info')) break;

    const params: Record<string, string> = {
      page_size: '50',
      fetch_child: 'true',
    };
    if (pageToken) params['page_token'] = pageToken;

    const resp = await feishuApi<FeishuListResp<FeishuDepartment>>(
      '/contact/v3/departments',
      { params },
    );
    trackApiCall('feishu', 'user_info');

    if (resp.code !== 0 || !resp.data?.items) break;

    for (const dept of resp.data.items) {
      deptMap.set(dept.open_department_id, dept.name);
    }

    pageToken = resp.data.has_more ? resp.data.page_token : undefined;
  } while (pageToken);

  return deptMap;
}

/** 拉取所有用户（通过部门遍历） */
async function fetchAllUsers(deptIds: string[]): Promise<FeishuUser[]> {
  const allUsers = new Map<string, FeishuUser>(); // open_id → user（去重）

  for (const deptId of deptIds) {
    let pageToken: string | undefined;
    do {
      if (!canCallFeishu('user_info')) break;

      const params: Record<string, string> = {
        department_id: deptId,
        page_size: '50',
      };
      if (pageToken) params['page_token'] = pageToken;

      const resp = await feishuApi<FeishuListResp<FeishuUser>>(
        '/contact/v3/users/find_by_department',
        { params },
      );
      trackApiCall('feishu', 'user_info');

      if (resp.code !== 0 || !resp.data?.items) break;

      for (const user of resp.data.items) {
        if (user.open_id && !allUsers.has(user.open_id)) {
          allUsers.set(user.open_id, user);
        }
      }

      pageToken = resp.data.has_more ? resp.data.page_token : undefined;
    } while (pageToken);
  }

  return Array.from(allUsers.values());
}

// ─── 角色匹配 ───

function resolveRole(
  user: FeishuUser,
  deptMap: Map<string, string>,
  mappings: RoleMapping[],
): Role {
  // 按 priority 降序排列
  const sorted = mappings.slice().sort((a, b) => b.priority - a.priority);

  for (const mapping of sorted) {
    if (mapping.match_type === 'open_id' && mapping.match_value === user.open_id) {
      return mapping.gateway_role;
    }

    if (mapping.match_type === 'job_title' && user.job_title) {
      if (user.job_title.includes(mapping.match_value)) {
        return mapping.gateway_role;
      }
    }

    if (mapping.match_type === 'department_name' && user.department_ids) {
      for (const deptId of user.department_ids) {
        const deptName = deptMap.get(deptId) ?? '';
        if (deptName.includes(mapping.match_value)) {
          return mapping.gateway_role;
        }
      }
    }
  }

  return 'member'; // 默认角色
}

// ─── 主同步函数 ───

export async function syncOrgStructure(): Promise<{ synced: number; deactivated: number }> {
  ensureTables();
  seedDefaultMappings();

  const db = getDb();
  const cursor = getCursor('feishu_org', 'last_synced_at');
  const isFirstSync = !cursor;

  log.info(`Starting org sync (${isFirstSync ? 'first' : 'incremental'})`);

  // 1. 拉取部门
  const deptMap = await fetchAllDepartments();
  log.info(`Fetched ${deptMap.size} departments`);

  if (deptMap.size === 0) {
    log.warn('No departments found, skipping sync');
    return { synced: 0, deactivated: 0 };
  }

  // 2. 拉取用户
  const users = await fetchAllUsers(Array.from(deptMap.keys()));
  log.info(`Fetched ${users.length} users`);

  // 3. 加载角色映射
  const mappings = db.prepare('SELECT * FROM feishu_role_mappings ORDER BY priority DESC')
    .all() as RoleMapping[];

  // 4. 遍历用户，upsert
  const upsert = db.prepare(`
    INSERT INTO users (user_id, feishu_open_id, name, email, role, department, avatar_url, is_active, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, datetime('now'), datetime('now'))
    ON CONFLICT(feishu_open_id) DO UPDATE SET
      name = excluded.name,
      email = COALESCE(excluded.email, users.email),
      role = CASE WHEN users.role_locked = 1 THEN users.role ELSE excluded.role END,
      department = excluded.department,
      avatar_url = COALESCE(excluded.avatar_url, users.avatar_url),
      is_active = 1,
      updated_at = datetime('now')
  `);

  const syncedOpenIds = new Set<string>();
  let synced = 0;

  const syncTx = db.transaction(() => {
    for (const user of users) {
      if (!user.open_id || !user.name) continue;
      if (user.status?.is_resigned) continue;

      const role = resolveRole(user, deptMap, mappings);

      // 拼接部门名
      const deptNames = (user.department_ids ?? [])
        .map(id => deptMap.get(id))
        .filter(Boolean)
        .join(' / ');

      const userId = `usr_feishu_${user.open_id.slice(-8)}`;

      upsert.run(
        userId,
        user.open_id,
        user.name,
        user.email ?? null,
        role,
        deptNames || null,
        user.avatar?.avatar_72 ?? null,
      );

      syncedOpenIds.add(user.open_id);
      synced++;
    }
  });

  syncTx();
  log.info(`Upserted ${synced} users`);

  // 5. 标记离职（首次同步跳过，防误杀）
  let deactivated = 0;
  if (!isFirstSync && syncedOpenIds.size > 0) {
    const activeRows = db.prepare(
      'SELECT user_id, feishu_open_id FROM users WHERE is_active = 1 AND feishu_open_id IS NOT NULL'
    ).all() as { user_id: string; feishu_open_id: string }[];

    const deactivateTx = db.transaction(() => {
      for (const row of activeRows) {
        if (!syncedOpenIds.has(row.feishu_open_id)) {
          db.prepare('UPDATE users SET is_active = 0, updated_at = datetime("now") WHERE user_id = ?')
            .run(row.user_id);
          deactivated++;
          log.info(`Deactivated user ${row.user_id} (feishu: ${row.feishu_open_id})`);
        }
      }
    });
    deactivateTx();
  }

  // 6. 更新 cursor
  setCursor('feishu_org', 'last_synced_at', new Date().toISOString());

  log.info(`Org sync complete: ${synced} synced, ${deactivated} deactivated`);
  return { synced, deactivated };
}
