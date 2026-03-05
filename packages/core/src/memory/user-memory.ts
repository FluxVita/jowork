/**
 * memory/user-memory.ts
 * 个人记忆库 — CRUD + 搜索
 */
import { randomBytes } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';
import { computeEmbedding, cosineSimilarity, loadMemoryEmbeddings } from './embedding.js';

const log = createLogger('user-memory');

export interface UserMemory {
  memory_id: string;
  user_id: string;
  title: string;
  content: string;
  tags: string[];
  scope: 'personal' | 'team';
  pinned: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MemoryRow {
  memory_id: string;
  user_id: string;
  title: string;
  content: string;
  tags_json: string;
  scope: string;
  pinned: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

function toMemory(row: MemoryRow): UserMemory {
  return {
    ...row,
    tags: JSON.parse(row.tags_json || '[]'),
    scope: row.scope as 'personal' | 'team',
    pinned: row.pinned === 1,
  };
}

export interface CreateMemoryInput {
  user_id: string;
  title: string;
  content: string;
  tags?: string[];
  scope?: 'personal' | 'team';
  pinned?: boolean;
}

export function createMemory(input: CreateMemoryInput): UserMemory {
  const db = getDb();
  const memory_id = randomBytes(12).toString('hex');
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO user_memories (memory_id, user_id, title, content, tags_json, scope, pinned, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    memory_id,
    input.user_id,
    input.title,
    input.content,
    JSON.stringify(input.tags ?? []),
    input.scope ?? 'personal',
    input.pinned ? 1 : 0,
    now,
    now
  );

  log.info('Memory created', { memory_id, user_id: input.user_id });
  return getMemoryById(memory_id, input.user_id)!;
}

export function getMemoryById(memory_id: string, user_id: string): UserMemory | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM user_memories WHERE memory_id = ? AND user_id = ?`)
    .get(memory_id, user_id) as MemoryRow | undefined;
  return row ? toMemory(row) : null;
}

export function getMemoryByTitle(user_id: string, title: string): UserMemory | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM user_memories WHERE user_id = ? AND title = ? LIMIT 1`)
    .get(user_id, title) as MemoryRow | undefined;
  return row ? toMemory(row) : null;
}

export interface ListMemoriesOptions {
  user_id: string;
  query?: string;
  tags?: string[];
  scope?: 'personal' | 'team';
  pinned_only?: boolean;
  limit?: number;
  offset?: number;
}

export function listUserMemories(opts: ListMemoriesOptions): UserMemory[] {
  const db = getDb();
  const { user_id, query, tags, scope, pinned_only, limit = 20, offset = 0 } = opts;

  let sql = `SELECT * FROM user_memories WHERE user_id = ?`;
  const params: unknown[] = [user_id];

  if (scope) {
    sql += ` AND scope = ?`;
    params.push(scope);
  }
  if (pinned_only) {
    sql += ` AND pinned = 1`;
  }
  if (query) {
    sql += ` AND (title LIKE ? OR content LIKE ?)`;
    params.push(`%${query}%`, `%${query}%`);
  }
  if (tags && tags.length > 0) {
    // 简单 JSON 包含匹配
    for (const tag of tags) {
      sql += ` AND tags_json LIKE ?`;
      params.push(`%${tag}%`);
    }
  }

  sql += ` ORDER BY pinned DESC, updated_at DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  const rows = db.prepare(sql).all(...params) as MemoryRow[];
  return rows.map(toMemory);
}

export interface UpdateMemoryInput {
  title?: string;
  content?: string;
  tags?: string[];
  scope?: 'personal' | 'team';
  pinned?: boolean;
}

export function updateMemory(memory_id: string, user_id: string, input: UpdateMemoryInput): UserMemory | null {
  const db = getDb();
  const existing = getMemoryById(memory_id, user_id);
  if (!existing) return null;

  const now = new Date().toISOString();
  db.prepare(`
    UPDATE user_memories SET
      title = ?, content = ?, tags_json = ?, scope = ?, pinned = ?, updated_at = ?
    WHERE memory_id = ? AND user_id = ?
  `).run(
    input.title ?? existing.title,
    input.content ?? existing.content,
    JSON.stringify(input.tags ?? existing.tags),
    input.scope ?? existing.scope,
    (input.pinned ?? existing.pinned) ? 1 : 0,
    now,
    memory_id,
    user_id
  );

  return getMemoryById(memory_id, user_id);
}

export function deleteMemory(memory_id: string, user_id: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM user_memories WHERE memory_id = ? AND user_id = ?`)
    .run(memory_id, user_id);
  return result.changes > 0;
}

/** 标记为最近使用（Agent 查询时调用） */
export function touchMemory(memory_id: string): void {
  const db = getDb();
  db.prepare(`UPDATE user_memories SET last_used_at = datetime('now') WHERE memory_id = ?`).run(memory_id);
}

/**
 * 语义搜索记忆库。
 *
 * 优先用向量余弦相似度排序，对无 embedding 的记忆回退到关键词 LIKE 匹配。
 * 当 embedding API 不可用时，完全回退到关键词搜索。
 *
 * @param user_id 用户 ID
 * @param query   搜索查询文本
 * @param limit   返回条数上限
 */
export async function semanticSearchMemories(
  user_id: string,
  query: string,
  limit = 5,
): Promise<UserMemory[]> {
  // 尝试计算 query embedding
  const queryVec = await computeEmbedding(query);

  if (!queryVec) {
    // API 不可用 → 直接关键词搜索
    return listUserMemories({ user_id, query, limit });
  }

  // 加载所有已有 embedding 的记忆
  const embeddingMap = loadMemoryEmbeddings(user_id);

  if (embeddingMap.size === 0) {
    // 没有任何 embedding → 回退关键词搜索
    return listUserMemories({ user_id, query, limit });
  }

  // 对有 embedding 的记忆按余弦相似度排序
  const scored: { memory_id: string; score: number }[] = [];
  for (const [memory_id, vec] of embeddingMap) {
    scored.push({ memory_id, score: cosineSimilarity(queryVec, vec) });
  }
  scored.sort((a, b) => b.score - a.score);

  const db = getDb();
  const topIds = scored.slice(0, limit).map(s => s.memory_id);
  const semanticResults = topIds
    .map(id => db.prepare('SELECT * FROM user_memories WHERE memory_id = ?').get(id) as MemoryRow | undefined)
    .filter((row): row is MemoryRow => row !== undefined)
    .map(row => toMemory(row));

  // 对没有 embedding 的记忆，补充关键词搜索结果（去重后填满 limit）
  const seen = new Set(semanticResults.map(m => m.memory_id));
  if (semanticResults.length < limit) {
    const keywordResults = listUserMemories({ user_id, query, limit: limit - semanticResults.length + 3 });
    for (const m of keywordResults) {
      if (!seen.has(m.memory_id) && semanticResults.length < limit) {
        semanticResults.push(m);
        seen.add(m.memory_id);
      }
    }
  }

  return semanticResults.slice(0, limit);
}
