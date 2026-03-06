import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('user-settings');
const ALGORITHM = 'aes-256-gcm';
const SETTINGS_KEY = createHash('sha256').update(config.jwt_secret + ':settings').digest();
/** 确保 user_settings 表存在 */
function ensureTable() {
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_encrypted TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, key)
    )
  `);
}
/** 加密值 */
function encrypt(plaintext) {
    const iv = randomBytes(16);
    const cipher = createCipheriv(ALGORITHM, SETTINGS_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // iv(16) + authTag(16) + encrypted → base64
    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}
/** 解密值 */
function decrypt(encoded) {
    const data = Buffer.from(encoded, 'base64');
    const iv = data.subarray(0, 16);
    const authTag = data.subarray(16, 32);
    const encrypted = data.subarray(32);
    const decipher = createDecipheriv(ALGORITHM, SETTINGS_KEY, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}
/** 设置用户配置 */
export function setUserSetting(userId, key, value) {
    ensureTable();
    const db = getDb();
    const encrypted = encrypt(value);
    db.prepare(`
    INSERT INTO user_settings (user_id, key, value_encrypted) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value_encrypted = excluded.value_encrypted, updated_at = datetime('now')
  `).run(userId, key, encrypted);
}
/** 获取用户配置 */
export function getUserSetting(userId, key) {
    ensureTable();
    const db = getDb();
    const row = db.prepare('SELECT value_encrypted FROM user_settings WHERE user_id = ? AND key = ?')
        .get(userId, key);
    if (!row)
        return null;
    try {
        return decrypt(row.value_encrypted);
    }
    catch {
        log.error(`Failed to decrypt setting ${key} for user ${userId}`);
        return null;
    }
}
/** 列出用户所有配置（键名列表，不含值） */
export function listUserSettingKeys(userId) {
    ensureTable();
    const db = getDb();
    return db.prepare('SELECT key, updated_at FROM user_settings WHERE user_id = ? ORDER BY key')
        .all(userId);
}
/** 删除用户配置 */
export function deleteUserSetting(userId, key) {
    ensureTable();
    const db = getDb();
    db.prepare('DELETE FROM user_settings WHERE user_id = ? AND key = ?').run(userId, key);
}
// ─── 便捷方法 ───
/** 可配置的系统级 key 白名单（渠道密钥已迁移到 channel-settings） */
const ALLOWED_KEYS = [
    'model_api_key_moonshot',
    'model_api_key_openai',
    'model_api_key_anthropic',
    'model_api_key_minimax',
    'notification_preference',
    'default_model_task_type',
    'default_agent_engine',
    'personal_emails',
    'group_emails',
];
/** 验证 key 是否在白名单中 */
export function isAllowedKey(key) {
    return ALLOWED_KEYS.includes(key);
}
export { ALLOWED_KEYS };
// ─── 三层 Scoped 配置 ───
/** 确保 scoped_settings 表存在（由 db.ts initSchema 创建，此处为安全检查） */
function ensureScopedTable() {
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS scoped_settings (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      scope      TEXT NOT NULL,
      scope_id   TEXT NOT NULL,
      key        TEXT NOT NULL,
      value_enc  TEXT NOT NULL,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(scope, scope_id, key)
    )
  `);
}
/** 写入指定 scope 的配置 */
export function setScopedValue(scope, scopeId, key, value) {
    ensureScopedTable();
    const db = getDb();
    const enc = encrypt(value);
    db.prepare(`
    INSERT INTO scoped_settings (scope, scope_id, key, value_enc)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope, scope_id, key)
    DO UPDATE SET value_enc = excluded.value_enc, updated_at = datetime('now')
  `).run(scope, scopeId, key, enc);
}
/** 获取 org 级配置（系统调用，不需要 userId） */
export function getOrgSetting(key) {
    ensureScopedTable();
    const db = getDb();
    const row = db.prepare("SELECT value_enc FROM scoped_settings WHERE scope = 'org' AND scope_id = 'default' AND key = ?").get(key);
    if (!row)
        return null;
    try {
        return decrypt(row.value_enc);
    }
    catch {
        return null;
    }
}
/** 三层查找：user → 所属 group → org（就近优先） */
export function getScopedValue(key, userId, groupIds = []) {
    ensureScopedTable();
    const db = getDb();
    // 1. 用户级
    const userRow = db.prepare("SELECT value_enc FROM scoped_settings WHERE scope = 'user' AND scope_id = ? AND key = ?").get(userId, key);
    if (userRow) {
        try {
            return { value: decrypt(userRow.value_enc), source: 'user' };
        }
        catch { /* skip */ }
    }
    // 2. 群组级（按 groupIds 顺序取第一个匹配）
    for (const gid of groupIds) {
        const groupRow = db.prepare("SELECT value_enc FROM scoped_settings WHERE scope = 'group' AND scope_id = ? AND key = ?").get(gid, key);
        if (groupRow) {
            try {
                return { value: decrypt(groupRow.value_enc), source: 'group' };
            }
            catch {
                continue;
            }
        }
    }
    // 3. org 级
    const orgVal = getOrgSetting(key);
    if (orgVal !== null)
        return { value: orgVal, source: 'org' };
    return null;
}
//# sourceMappingURL=settings.js.map