import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
import type { User, Role } from '../types.js';

function rowToUser(row: Record<string, unknown>): User {
  return {
    user_id: row['user_id'] as string,
    feishu_open_id: row['feishu_open_id'] as string,
    name: row['name'] as string,
    email: row['email'] as string | undefined,
    role: row['role'] as Role,
    department: row['department'] as string | undefined,
    avatar_url: row['avatar_url'] as string | undefined,
    is_active: (row['is_active'] as number) === 1,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  };
}

/** 通过飞书 Open ID 查找或创建用户 */
export function findOrCreateByFeishu(feishuOpenId: string, name: string, opts?: {
  email?: string;
  role?: Role;
  department?: string;
}): User {
  const db = getDb();
  const existing = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(feishuOpenId) as Record<string, unknown> | undefined;

  if (existing) return rowToUser(existing);

  const userId = genId('usr');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO users (user_id, feishu_open_id, name, email, role, department, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, feishuOpenId, name, opts?.email ?? null, opts?.role ?? 'member', opts?.department ?? null, now, now);

  return {
    user_id: userId,
    feishu_open_id: feishuOpenId,
    name,
    email: opts?.email,
    role: opts?.role ?? 'member',
    department: opts?.department,
    is_active: true,
    created_at: now,
    updated_at: now,
  };
}

/** 通过 user_id 查找 */
export function getUserById(userId: string): User | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

/** 通过飞书 Open ID 查找 */
export function getUserByFeishuId(feishuOpenId: string): User | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(feishuOpenId) as Record<string, unknown> | undefined;
  return row ? rowToUser(row) : null;
}

/** 更新用户角色 */
export function updateUserRole(userId: string, role: Role) {
  const db = getDb();
  db.prepare('UPDATE users SET role = ?, updated_at = datetime("now") WHERE user_id = ?').run(role, userId);
}

/** 列出所有活跃用户 */
export function listActiveUsers(): User[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY created_at').all() as Record<string, unknown>[];
  return rows.map(rowToUser);
}

/** 停用用户（离职） */
export function deactivateUser(userId: string) {
  const db = getDb();
  db.prepare('UPDATE users SET is_active = 0, updated_at = datetime("now") WHERE user_id = ?').run(userId);
}
