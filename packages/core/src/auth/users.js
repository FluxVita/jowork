import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
function rowToUser(row) {
    return {
        user_id: row['user_id'],
        feishu_open_id: row['feishu_open_id'],
        name: row['name'],
        email: row['email'],
        role: row['role'],
        department: row['department'],
        avatar_url: row['avatar_url'],
        is_active: row['is_active'] === 1,
        created_at: row['created_at'],
        updated_at: row['updated_at'],
    };
}
/** 通过飞书 Open ID 查找或创建用户 */
export function findOrCreateByFeishu(feishuOpenId, name, opts) {
    const db = getDb();
    const existing = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(feishuOpenId);
    if (existing)
        return rowToUser(existing);
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
export function getUserById(userId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId);
    return row ? rowToUser(row) : null;
}
/** 通过飞书 Open ID 查找 */
export function getUserByFeishuId(feishuOpenId) {
    const db = getDb();
    const row = db.prepare('SELECT * FROM users WHERE feishu_open_id = ?').get(feishuOpenId);
    return row ? rowToUser(row) : null;
}
/** 更新用户角色 */
export function updateUserRole(userId, role) {
    const db = getDb();
    db.prepare('UPDATE users SET role = ?, updated_at = datetime("now") WHERE user_id = ?').run(role, userId);
}
/** 列出所有活跃用户 */
export function listActiveUsers() {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM users WHERE is_active = 1 ORDER BY created_at').all();
    return rows.map(rowToUser);
}
/** 停用用户（离职） */
export function deactivateUser(userId) {
    const db = getDb();
    db.prepare('UPDATE users SET is_active = 0, updated_at = datetime("now") WHERE user_id = ?').run(userId);
}
//# sourceMappingURL=users.js.map