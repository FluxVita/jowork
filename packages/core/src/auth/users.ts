import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { User, Role } from '../types.js';

// ─── 密码哈希（scrypt，无额外依赖） ───

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!stored) return false;  // OAuth-only user, 不允许密码登录
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derivedKey = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, (err, dk) => (err ? reject(err) : resolve(dk)));
  });
  try {
    return timingSafeEqual(Buffer.from(hash, 'hex'), derivedKey);
  } catch {
    return false;
  }
}

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

/** 通过邮箱查找 */
export function getUserByEmail(email: string): (User & { password_hash: string | null }) | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE email = ? AND is_active = 1').get(email.toLowerCase().trim()) as Record<string, unknown> | undefined;
  if (!row) return null;
  return { ...rowToUser(row), password_hash: (row['password_hash'] as string | null) ?? null };
}

/** 创建邮箱/OAuth 注册用户（passwordHash 为空字符串时表示纯 OAuth 用户） */
export function createEmailUser(opts: {
  name: string;
  email: string;
  passwordHash: string; // '' = OAuth only, 不能用密码登录
}): User {
  const db = getDb();
  const userId = genId('usr');
  const now = new Date().toISOString();
  const emailNorm = opts.email.toLowerCase().trim();

  db.prepare(`
    INSERT INTO users (user_id, feishu_open_id, name, email, password_hash, role, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'member', ?, ?)
  `).run(userId, `email_${userId}`, opts.name, emailNorm, opts.passwordHash, now, now);

  return { user_id: userId, feishu_open_id: `email_${userId}`, name: opts.name, email: emailNorm, role: 'member', is_active: true, created_at: now, updated_at: now };
}
