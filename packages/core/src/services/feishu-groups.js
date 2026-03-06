import { getDb } from '../datamap/db.js';
import { feishuApi } from '../connectors/feishu/auth.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('feishu-groups');
/** 获取 bot 所在的群列表 */
async function fetchBotChats() {
    const chats = [];
    let pageToken = '';
    do {
        const params = { page_size: '50' };
        if (pageToken)
            params['page_token'] = pageToken;
        const resp = await feishuApi('/im/v1/chats', { params });
        if (resp.code !== 0) {
            log.error('Failed to fetch bot chats', resp);
            break;
        }
        for (const item of resp.data.items || []) {
            chats.push({ chat_id: item.chat_id, name: item.name });
        }
        pageToken = resp.data.has_more ? (resp.data.page_token ?? '') : '';
    } while (pageToken);
    return chats;
}
/** 获取群成员的 open_id 列表 */
async function fetchChatMembers(chatId) {
    const members = [];
    let pageToken = '';
    do {
        const params = { member_id_type: 'open_id', page_size: '50' };
        if (pageToken)
            params['page_token'] = pageToken;
        const resp = await feishuApi(`/im/v1/chats/${chatId}/members`, { params });
        if (resp.code !== 0) {
            log.warn('Failed to fetch chat members', { chatId, code: resp.code });
            break;
        }
        for (const m of resp.data.items || []) {
            if (m.member_id)
                members.push(m.member_id);
        }
        pageToken = resp.data.has_more ? (resp.data.page_token ?? '') : '';
    } while (pageToken);
    return members;
}
/** 同步全量群组映射 */
export async function syncAllUserGroups() {
    const db = getDb();
    let chats;
    try {
        chats = await fetchBotChats();
    }
    catch (err) {
        log.error('syncAllUserGroups: failed to fetch chats', err);
        return { synced: 0 };
    }
    log.info(`Found ${chats.length} bot chats`);
    // 查找 feishu_open_id → user_id 映射
    const userMap = new Map();
    const users = db.prepare('SELECT user_id, feishu_open_id FROM users WHERE is_active = 1').all();
    for (const u of users) {
        if (u.feishu_open_id)
            userMap.set(u.feishu_open_id, u.user_id);
    }
    // 先异步收集所有群成员
    const chatMembersCache = new Map();
    for (const chat of chats) {
        try {
            const members = await fetchChatMembers(chat.chat_id);
            chatMembersCache.set(chat.chat_id, members);
        }
        catch (err) {
            log.warn(`Failed to fetch members for chat ${chat.name}`, err);
        }
    }
    // 同步事务写入
    const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO user_groups (user_id, group_id, group_name, synced_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
    let synced = 0;
    const rebuild = db.transaction(() => {
        db.prepare('DELETE FROM user_groups').run();
        for (const chat of chats) {
            const members = chatMembersCache.get(chat.chat_id) ?? [];
            for (const openId of members) {
                const userId = userMap.get(openId);
                if (userId) {
                    insertStmt.run(userId, chat.chat_id, chat.name);
                    synced++;
                }
            }
        }
    });
    rebuild();
    log.info(`User groups synced: ${synced} mappings`);
    return { synced };
}
/** 同步单个用户的群组（登录时调用） */
export async function syncUserGroups(userId, feishuOpenId) {
    const db = getDb();
    let chats;
    try {
        chats = await fetchBotChats();
    }
    catch (err) {
        log.warn('syncUserGroups: failed to fetch chats', err);
        return getUserGroups(userId);
    }
    // 清除该用户旧记录并重建
    const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO user_groups (user_id, group_id, group_name, synced_at)
    VALUES (?, ?, ?, datetime('now'))
  `);
    db.prepare('DELETE FROM user_groups WHERE user_id = ?').run(userId);
    for (const chat of chats) {
        try {
            const members = await fetchChatMembers(chat.chat_id);
            if (members.includes(feishuOpenId)) {
                insertStmt.run(userId, chat.chat_id, chat.name);
            }
        }
        catch {
            // skip failed chats
        }
    }
    return getUserGroups(userId);
}
/** 查询用户所在群组 */
export function getUserGroups(userId) {
    const db = getDb();
    return db.prepare('SELECT * FROM user_groups WHERE user_id = ? ORDER BY group_name').all(userId);
}
/** 查询所有已同步的群组（去重） */
export function listSyncedGroups() {
    const db = getDb();
    return db.prepare(`
    SELECT group_id, group_name, COUNT(*) as member_count
    FROM user_groups
    GROUP BY group_id
    ORDER BY group_name
  `).all();
}
//# sourceMappingURL=feishu-groups.js.map