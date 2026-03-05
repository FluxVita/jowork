/**
 * connectors/sync-state.ts
 * 增量同步状态管理 — cursor/last_indexed_at 持久化
 */
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('sync-state');

interface SyncStateRow {
  connector_id: string;
  cursor_key: string;
  cursor_value: string;
  updated_at: string;
}

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
export function getCursor(connectorId: string, cursorKey: string): string | null {
  ensureTable();
  const db = getDb();
  const row = db.prepare(`
    SELECT cursor_value FROM connector_sync_state WHERE connector_id = ? AND cursor_key = ?
  `).get(connectorId, cursorKey) as SyncStateRow | undefined;
  return row?.cursor_value ?? null;
}

/** 保存 cursor */
export function setCursor(connectorId: string, cursorKey: string, value: string): void {
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
export function resetCursor(connectorId: string, cursorKey?: string): void {
  ensureTable();
  const db = getDb();
  if (cursorKey) {
    db.prepare(`DELETE FROM connector_sync_state WHERE connector_id = ? AND cursor_key = ?`).run(connectorId, cursorKey);
  } else {
    db.prepare(`DELETE FROM connector_sync_state WHERE connector_id = ?`).run(connectorId);
  }
  log.info('Cursor reset', { connectorId, cursorKey });
}

/** 列出某 connector 的所有 cursor */
export function listCursors(connectorId: string): Record<string, string> {
  ensureTable();
  const db = getDb();
  const rows = db.prepare(`SELECT cursor_key, cursor_value FROM connector_sync_state WHERE connector_id = ?`)
    .all(connectorId) as Array<{ cursor_key: string; cursor_value: string }>;
  return Object.fromEntries(rows.map(r => [r.cursor_key, r.cursor_value]));
}
