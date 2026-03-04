// @jowork/core/connectors/cache — connector content cache
//
// Caches fetched content from connectors into connector_items + FTS5.
// Provides sync (discover+fetch all), query (list+search), and delete operations.

import { getDb } from '../datamap/db.js';
import { generateId, nowISO, logger } from '../utils/index.js';
import { getConnectorConfig } from './index.js';
import { discoverViaConnector } from './index.js';
import { getJCPConnector } from './protocol.js';
import type { ConnectorId } from '../types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConnectorItem {
  id: string;
  connectorId: string;
  uri: string;
  title: string;
  content: string;
  contentType: string;
  url?: string;
  sensitivity: string;
  fetchedAt: string;
}

export interface SyncResult {
  synced: number;
  errors: number;
  total: number;
}

// ─── Internal row mapping ────────────────────────────────────────────────────

interface ItemRow {
  id: string;
  connector_id: string;
  uri: string;
  title: string;
  content: string;
  content_type: string;
  url: string | null;
  sensitivity: string;
  fetched_at: string;
}

function fromRow(row: ItemRow): ConnectorItem {
  return {
    id: row.id,
    connectorId: row.connector_id,
    uri: row.uri,
    title: row.title,
    content: row.content,
    contentType: row.content_type,
    ...(row.url !== null ? { url: row.url } : {}),
    sensitivity: row.sensitivity,
    fetchedAt: row.fetched_at,
  };
}

// ─── Sync ────────────────────────────────────────────────────────────────────

/**
 * Sync a connector's content into the local cache.
 * Discovers all objects, fetches each, and upserts into connector_items + FTS.
 */
export async function syncConnectorItems(connectorId: ConnectorId): Promise<SyncResult> {
  const cfg = getConnectorConfig(connectorId);
  const jcp = getJCPConnector(cfg.kind);

  // Discover all objects (paginated)
  const allObjects: Array<{ id: string; name: string; kind: string; url?: string }> = [];
  let cursor: string | undefined;
  do {
    const page = await discoverViaConnector(cfg, cursor);
    allObjects.push(...page.objects);
    cursor = page.nextCursor;
  } while (cursor);

  const db = getDb();
  const now = nowISO();
  let synced = 0;
  let errors = 0;

  for (const obj of allObjects) {
    try {
      // Fetch content
      let title = obj.name;
      let content = '';
      let contentType = 'text/plain';
      let url = obj.url;
      let sensitivity = 'internal';

      if (jcp) {
        const apiKey = cfg.settings['apiKey'] as string | undefined;
        await jcp.initialize(cfg.settings, apiKey ? { apiKey } : {});
        const fetched = await jcp.fetch(obj.id);
        title = fetched.title;
        content = fetched.content;
        contentType = fetched.contentType;
        if (fetched.url) url = fetched.url;
        if (fetched.sensitivity) sensitivity = fetched.sensitivity;
      }

      // Upsert into connector_items
      const existing = db.prepare(
        `SELECT id, rowid FROM connector_items WHERE connector_id = ? AND uri = ?`,
      ).get(connectorId, obj.id) as { id: string; rowid: number } | undefined;

      if (existing) {
        db.prepare(`
          UPDATE connector_items SET title = ?, content = ?, content_type = ?, url = ?, sensitivity = ?, fetched_at = ?
          WHERE id = ?
        `).run(title, content, contentType, url ?? null, sensitivity, now, existing.id);
        // Update FTS
        db.prepare(`UPDATE connector_items_fts SET title = ?, content = ? WHERE rowid = ?`)
          .run(title, content, existing.rowid);
      } else {
        const itemId = generateId();
        db.prepare(`
          INSERT INTO connector_items (id, connector_id, uri, title, content, content_type, url, sensitivity, fetched_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(itemId, connectorId, obj.id, title, content, contentType, url ?? null, sensitivity, now);
        // Insert into FTS — get rowid of newly inserted row
        const inserted = db.prepare(`SELECT rowid FROM connector_items WHERE id = ?`).get(itemId) as { rowid: number };
        db.prepare(`INSERT INTO connector_items_fts(rowid, title, content) VALUES (?, ?, ?)`)
          .run(inserted.rowid, title, content);
      }

      synced++;
    } catch (err) {
      errors++;
      logger.warn('Connector item sync failed', { connectorId, uri: obj.id, err: String(err) });
    }
  }

  logger.info('Connector sync complete', { connectorId, synced, errors, total: allObjects.length });
  return { synced, errors, total: allObjects.length };
}

// ─── Query ───────────────────────────────────────────────────────────────────

/**
 * List cached items for a connector, with optional FTS search.
 */
export function listConnectorItems(
  connectorId: ConnectorId,
  opts?: { query?: string; limit?: number; offset?: number },
): { items: ConnectorItem[]; total: number } {
  const db = getDb();
  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;

  if (opts?.query?.trim()) {
    // FTS search with fallback to LIKE
    try {
      const rows = db.prepare(`
        SELECT ci.* FROM connector_items ci
        JOIN connector_items_fts fts ON fts.rowid = ci.rowid
        WHERE ci.connector_id = ? AND connector_items_fts MATCH ?
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(connectorId, opts.query, limit, offset) as ItemRow[];

      const countRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM connector_items ci
        JOIN connector_items_fts fts ON fts.rowid = ci.rowid
        WHERE ci.connector_id = ? AND connector_items_fts MATCH ?
      `).get(connectorId, opts.query) as { cnt: number };

      return { items: rows.map(fromRow), total: countRow.cnt };
    } catch {
      // FTS syntax error → fallback to LIKE
      const pattern = `%${opts.query}%`;
      const rows = db.prepare(`
        SELECT * FROM connector_items
        WHERE connector_id = ? AND (title LIKE ? OR content LIKE ?)
        ORDER BY fetched_at DESC
        LIMIT ? OFFSET ?
      `).all(connectorId, pattern, pattern, limit, offset) as ItemRow[];

      const countRow = db.prepare(`
        SELECT COUNT(*) as cnt FROM connector_items
        WHERE connector_id = ? AND (title LIKE ? OR content LIKE ?)
      `).get(connectorId, pattern, pattern) as { cnt: number };

      return { items: rows.map(fromRow), total: countRow.cnt };
    }
  }

  // No search — list all
  const rows = db.prepare(`
    SELECT * FROM connector_items WHERE connector_id = ? ORDER BY fetched_at DESC LIMIT ? OFFSET ?
  `).all(connectorId, limit, offset) as ItemRow[];

  const countRow = db.prepare(`
    SELECT COUNT(*) as cnt FROM connector_items WHERE connector_id = ?
  `).get(connectorId) as { cnt: number };

  return { items: rows.map(fromRow), total: countRow.cnt };
}

/**
 * Get the count of cached items for a connector.
 */
export function countConnectorItems(connectorId: ConnectorId): number {
  const db = getDb();
  const row = db.prepare(`SELECT COUNT(*) as cnt FROM connector_items WHERE connector_id = ?`)
    .get(connectorId) as { cnt: number };
  return row.cnt;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete all cached items for a connector.
 */
export function deleteConnectorItems(connectorId: ConnectorId): number {
  const db = getDb();

  // Delete FTS entries first
  db.prepare(`
    DELETE FROM connector_items_fts WHERE rowid IN (
      SELECT rowid FROM connector_items WHERE connector_id = ?
    )
  `).run(connectorId);

  const result = db.prepare(`DELETE FROM connector_items WHERE connector_id = ?`).run(connectorId);
  return result.changes;
}
