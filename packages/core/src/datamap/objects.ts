import { getDb } from './db.js';
import { genId } from '../utils/id.js';
import { readContentByPath } from './content-store.js';
import type { DataObject, Sensitivity, DataSource, SourceType, DataScope } from '../types.js';

function normalizeSensitivity(input: unknown): Sensitivity {
  if (input === 'public' || input === 'internal' || input === 'restricted' || input === 'secret') {
    return input;
  }
  return 'public';
}

// ─── 行到对象的转换 ───
function rowToObject(row: Record<string, unknown>): DataObject {
  return {
    object_id: row['object_id'] as string,
    source: row['source'] as DataSource,
    source_type: row['source_type'] as SourceType,
    uri: row['uri'] as string,
    external_url: row['external_url'] as string | undefined,
    title: row['title'] as string,
    summary: row['summary'] as string | undefined,
    sensitivity: row['sensitivity'] as Sensitivity,
    acl: JSON.parse(row['acl_json'] as string),
    tags: JSON.parse(row['tags_json'] as string),
    etag: row['etag'] as string | undefined,
    owner: row['owner'] as string | undefined,
    content_type: row['content_type'] as string | undefined,
    size_bytes: row['size_bytes'] as number | undefined,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
    last_indexed_at: row['last_indexed_at'] as string,
    ttl_seconds: row['ttl_seconds'] as number,
    connector_id: row['connector_id'] as string,
    data_scope: (row['data_scope'] as DataScope) || undefined,
    content_path: row['content_path'] as string | undefined,
    content_length: row['content_length'] as number | undefined,
    metadata: row['metadata_json'] ? JSON.parse(row['metadata_json'] as string) : undefined,
  };
}

// ─── 插入或更新对象 ───
export function upsertObject(obj: Omit<DataObject, 'object_id' | 'created_at' | 'last_indexed_at'> & { object_id?: string }) {
  const db = getDb();
  const id = obj.object_id || genId('dm');
  const now = new Date().toISOString();
  const sensitivity = normalizeSensitivity(obj.sensitivity);

  db.prepare(`
    INSERT INTO objects (object_id, source, source_type, uri, external_url, title, summary,
      sensitivity, acl_json, tags_json, etag, owner, content_type, size_bytes,
      updated_at, last_indexed_at, ttl_seconds, connector_id, metadata_json, data_scope,
      content_path, content_length)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(uri) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      sensitivity = excluded.sensitivity,
      acl_json = excluded.acl_json,
      tags_json = excluded.tags_json,
      etag = excluded.etag,
      updated_at = excluded.updated_at,
      last_indexed_at = excluded.last_indexed_at,
      metadata_json = excluded.metadata_json,
      data_scope = excluded.data_scope,
      content_path = excluded.content_path,
      content_length = excluded.content_length
  `).run(
    id, obj.source, obj.source_type, obj.uri, obj.external_url ?? null,
    obj.title, obj.summary ?? null, sensitivity,
    JSON.stringify(obj.acl), JSON.stringify(obj.tags),
    obj.etag ?? null, obj.owner ?? null, obj.content_type ?? null,
    obj.size_bytes ?? null, obj.updated_at, now,
    obj.ttl_seconds, obj.connector_id, obj.metadata ? JSON.stringify(obj.metadata) : null,
    obj.data_scope ?? 'public',
    obj.content_path ?? null, obj.content_length ?? null,
  );

  // 同步更新 FTS5 索引
  syncObjectFts(db, id, obj.title, obj.summary, obj.content_path);

  return id;
}

/** 同步 objects_fts 索引（upsert 时调用） */
function syncObjectFts(
  db: ReturnType<typeof getDb>,
  objectId: string,
  title: string,
  summary: string | undefined,
  contentPath: string | undefined,
) {
  // 读取全文内容（如果有 content_path）
  const content = contentPath ? (readContentByPath(contentPath) ?? '') : '';

  // 先查 rowid
  const existing = db.prepare('SELECT rowid FROM objects WHERE object_id = ?').get(objectId) as { rowid: number } | undefined;
  if (!existing) return;

  const rowid = existing.rowid;

  // 删除旧的 FTS 条目（如果存在）
  db.prepare('DELETE FROM objects_fts WHERE rowid = ?').run(rowid);

  // 插入新的 FTS 条目
  db.prepare(`
    INSERT INTO objects_fts(rowid, title, summary, content)
    VALUES (?, ?, ?, ?)
  `).run(rowid, title, summary ?? '', content);
}

// ─── 搜索对象（带权限裁剪在调用侧做） ───
export function searchObjects(opts: {
  query?: string;
  source?: DataSource;
  source_type?: SourceType;
  sensitivity?: Sensitivity;
  data_scope?: DataScope;
  tags?: string[];
  /** 只返回 updated_at >= 此值的对象（ISO 8601 日期，如 "2026-03-09"） */
  updated_after?: string;
  limit?: number;
  offset?: number;
}): DataObject[] {
  const db = getDb();
  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  // 有搜索词时使用 FTS5
  if (opts.query) {
    return searchWithFts(db, opts, limit, offset);
  }

  // 无搜索词时使用普通过滤
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.source) {
    conditions.push('source = ?');
    params.push(opts.source);
  }
  if (opts.source_type) {
    conditions.push('source_type = ?');
    params.push(opts.source_type);
  }
  if (opts.sensitivity) {
    conditions.push('sensitivity = ?');
    params.push(opts.sensitivity);
  }
  if (opts.data_scope) {
    conditions.push('data_scope = ?');
    params.push(opts.data_scope);
  }
  if (opts.tags?.length) {
    for (const tag of opts.tags) {
      conditions.push("tags_json LIKE ?");
      params.push(`%"${tag}"%`);
    }
  }
  if (opts.updated_after) {
    conditions.push('updated_at >= ?');
    params.push(opts.updated_after);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT * FROM objects ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToObject);
}

/** FTS5 全文搜索 — 同时搜 objects_fts，按相关度排序 */
function searchWithFts(
  db: ReturnType<typeof getDb>,
  opts: {
    query?: string;
    source?: DataSource;
    source_type?: SourceType;
    sensitivity?: Sensitivity;
    data_scope?: DataScope;
    tags?: string[];
  },
  limit: number,
  offset: number,
): DataObject[] {
  // 构建 FTS5 匹配表达式：用空格分词，每个词加 *（前缀匹配）
  const words = (opts.query ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  // FTS5 MATCH 表达式：每个词前缀匹配
  const ftsExpr = words.map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ');

  // 额外的 WHERE 条件（source/sensitivity 等筛选在 objects 表上）
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.source) {
    conditions.push('o.source = ?');
    params.push(opts.source);
  }
  if (opts.source_type) {
    conditions.push('o.source_type = ?');
    params.push(opts.source_type);
  }
  if (opts.sensitivity) {
    conditions.push('o.sensitivity = ?');
    params.push(opts.sensitivity);
  }
  if (opts.data_scope) {
    conditions.push('o.data_scope = ?');
    params.push(opts.data_scope);
  }
  if (opts.tags?.length) {
    for (const tag of opts.tags) {
      conditions.push("o.tags_json LIKE ?");
      params.push(`%"${tag}"%`);
    }
  }

  const extraWhere = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  try {
    const rows = db.prepare(`
      SELECT o.* FROM objects o
      INNER JOIN objects_fts fts ON fts.rowid = o.rowid
      WHERE objects_fts MATCH ?
      ${extraWhere}
      ORDER BY rank
      LIMIT ? OFFSET ?
    `).all(ftsExpr, ...params, limit, offset) as Record<string, unknown>[];

    if (rows.length > 0) return rows.map(rowToObject);
  } catch {
    // FTS 索引可能为空或查询语法错误，降级到 LIKE
  }

  // FTS 降级：回退到 LIKE 搜索（兼容 FTS 索引未建立的场景）
  const likeConditions = [
    '(o.title LIKE ? OR o.summary LIKE ? OR o.source LIKE ? OR o.source_type LIKE ? OR o.tags_json LIKE ?)',
  ];
  const likeParams: unknown[] = [];
  const qLike = `%${opts.query}%`;
  likeParams.push(qLike, qLike, qLike, qLike, qLike);

  if (opts.source) { likeConditions.push('o.source = ?'); likeParams.push(opts.source); }
  if (opts.source_type) { likeConditions.push('o.source_type = ?'); likeParams.push(opts.source_type); }
  if (opts.sensitivity) { likeConditions.push('o.sensitivity = ?'); likeParams.push(opts.sensitivity); }
  if (opts.data_scope) { likeConditions.push('o.data_scope = ?'); likeParams.push(opts.data_scope); }
  if (opts.tags?.length) {
    for (const tag of opts.tags) {
      likeConditions.push("o.tags_json LIKE ?");
      likeParams.push(`%"${tag}"%`);
    }
  }

  const rows = db.prepare(
    `SELECT o.* FROM objects o WHERE ${likeConditions.join(' AND ')} ORDER BY o.updated_at DESC LIMIT ? OFFSET ?`
  ).all(...likeParams, limit, offset) as Record<string, unknown>[];

  return rows.map(rowToObject);
}

/** 搜索群聊消息（FTS5），支持按 allowed_chat_ids 权限过滤 */
export function searchChatMessages(opts: {
  query: string;
  chat_id?: string;
  allowed_chat_ids?: string[];
  limit?: number;
}): {
  message_id: string;
  chat_id: string;
  sender_name: string;
  content_text: string;
  created_at: string;
  msg_type: string;
}[] {
  const db = getDb();
  const limit = opts.limit ?? 20;

  // 空数组 → 用户不在任何群，直接返回空
  if (opts.allowed_chat_ids && opts.allowed_chat_ids.length === 0) return [];

  const words = opts.query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const ftsExpr = words.map(w => `"${w.replace(/"/g, '""')}"*`).join(' OR ');

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.chat_id) {
    conditions.push('cm.chat_id = ?');
    params.push(opts.chat_id);
  }

  // 权限过滤：只搜用户所属群的消息
  if (opts.allowed_chat_ids) {
    const placeholders = opts.allowed_chat_ids.map(() => '?').join(', ');
    conditions.push(`cm.chat_id IN (${placeholders})`);
    params.push(...opts.allowed_chat_ids);
  }

  const extraWhere = conditions.length ? `AND ${conditions.join(' AND ')}` : '';

  const mapRow = (r: Record<string, unknown>) => ({
    message_id: r['message_id'] as string,
    chat_id: r['chat_id'] as string,
    sender_name: r['sender_name'] as string || '',
    content_text: r['content_text'] as string || '',
    created_at: r['created_at'] as string,
    msg_type: r['msg_type'] as string,
  });

  try {
    const rows = db.prepare(`
      SELECT cm.* FROM chat_messages cm
      INNER JOIN chat_fts cfts ON cfts.rowid = cm.id
      WHERE chat_fts MATCH ?
      ${extraWhere}
      ORDER BY rank
      LIMIT ?
    `).all(ftsExpr, ...params, limit) as Record<string, unknown>[];

    return rows.map(mapRow);
  } catch {
    // FTS 降级：LIKE 搜索也加 allowed_chat_ids 过滤
    const likeConditions = ['content_text LIKE ?'];
    const likeParams: unknown[] = [`%${opts.query}%`];

    if (opts.chat_id) {
      likeConditions.push('chat_id = ?');
      likeParams.push(opts.chat_id);
    }
    if (opts.allowed_chat_ids) {
      const placeholders = opts.allowed_chat_ids.map(() => '?').join(', ');
      likeConditions.push(`chat_id IN (${placeholders})`);
      likeParams.push(...opts.allowed_chat_ids);
    }

    const likeRows = db.prepare(`
      SELECT * FROM chat_messages
      WHERE ${likeConditions.join(' AND ')}
      ORDER BY created_at DESC LIMIT ?
    `).all(...likeParams, limit) as Record<string, unknown>[];

    return likeRows.map(mapRow);
  }
}

// ─── 获取单个对象 ───
export function getObject(objectId: string): DataObject | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM objects WHERE object_id = ?').get(objectId) as Record<string, unknown> | undefined;
  return row ? rowToObject(row) : null;
}

// ─── 通过 URI 获取 ───
export function getObjectByUri(uri: string): DataObject | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM objects WHERE uri = ?').get(uri) as Record<string, unknown> | undefined;
  return row ? rowToObject(row) : null;
}

// ─── 统计 ───
export function getStats() {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM objects').get() as { n: number }).n;
  const bySource = db.prepare('SELECT source, COUNT(*) as n FROM objects GROUP BY source').all() as { source: string; n: number }[];
  const bySensitivity = db.prepare('SELECT sensitivity, COUNT(*) as n FROM objects GROUP BY sensitivity').all() as { sensitivity: string; n: number }[];
  return { total, bySource, bySensitivity };
}
