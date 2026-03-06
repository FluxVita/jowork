/**
 * connectors/sync-state.ts
 * 增量同步状态管理 — cursor/last_indexed_at 持久化
 */
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';
const log = createLogger('sync-state');
function ensureTable() {
    const db = getDb();
    db.exec(`
    CREATE TABLE IF NOT EXISTS connector_sync_state (
      connector_id  TEXT NOT NULL,
      cursor_key    TEXT NOT NULL,
      cursor_value  TEXT NOT NULL,
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (connector_id, cursor_key)
    )
  `);
}
/** 读取 cursor（不存在返回 null） */
export function getCursor(connectorId, cursorKey) {
    ensureTable();
    const db = getDb();
    const row = db.prepare(`
    SELECT cursor_value FROM connector_sync_state WHERE connector_id = ? AND cursor_key = ?
  `).get(connectorId, cursorKey);
    return row?.cursor_value ?? null;
}
/** 保存 cursor */
export function setCursor(connectorId, cursorKey, value) {
    ensureTable();
    const db = getDb();
    db.prepare(`
    INSERT INTO connector_sync_state (connector_id, cursor_key, cursor_value)
    VALUES (?, ?, ?)
    ON CONFLICT (connector_id, cursor_key) DO UPDATE SET cursor_value = excluded.cursor_value, updated_at = datetime('now')
  `).run(connectorId, cursorKey, value);
    log.debug('Cursor updated', { connectorId, cursorKey, value });
}
/** 删除 cursor（重置为全量同步） */
export function resetCursor(connectorId, cursorKey) {
    ensureTable();
    const db = getDb();
    if (cursorKey) {
        db.prepare(`DELETE FROM connector_sync_state WHERE connector_id = ? AND cursor_key = ?`).run(connectorId, cursorKey);
    }
    else {
        db.prepare(`DELETE FROM connector_sync_state WHERE connector_id = ?`).run(connectorId);
    }
    log.info('Cursor reset', { connectorId, cursorKey });
}
/** 列出某 connector 的所有 cursor */
export function listCursors(connectorId) {
    ensureTable();
    const db = getDb();
    const rows = db.prepare(`SELECT cursor_key, cursor_value FROM connector_sync_state WHERE connector_id = ?`)
        .all(connectorId);
    return Object.fromEntries(rows.map(r => [r.cursor_key, r.cursor_value]));
}
//# sourceMappingURL=sync-state.js.map