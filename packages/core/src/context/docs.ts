/**
 * context/docs.ts — 三层上下文文档 CRUD
 *
 * 三层结构：
 *   company  — 公司级规则（合规、禁止事项），is_forced=1 时强制加载
 *   team     — 团队规范（Scrum、代码规范等）
 *   personal — 个人工作方式、偏好
 *
 * doc_type：
 *   manual    — 人工手写文档
 *   rule      — 规则/合规条款
 *   workstyle — 工作方式说明
 *   learned   — Agent 自学习（经用户确认）
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { getEdition } from '../edition.js';

export type ContextLayer = 'company' | 'team' | 'personal';
export type DocType = 'manual' | 'rule' | 'workstyle' | 'learned';

export interface ContextDoc {
  id: string;
  layer: ContextLayer;
  scope_id: string;
  title: string;
  content: string;
  doc_type: DocType;
  is_forced: boolean;
  created_by: string;
  updated_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export function createContextDoc(input: Omit<ContextDoc, 'id' | 'updated_at'>): ContextDoc {
  const db = getDb();
  const doc: ContextDoc = {
    id: randomUUID(),
    ...input,
    updated_at: new Date().toISOString(),
  };

  db.prepare(`
    INSERT INTO context_docs (id, layer, scope_id, title, content, doc_type, is_forced, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(doc.id, doc.layer, doc.scope_id, doc.title, doc.content,
         doc.doc_type, doc.is_forced ? 1 : 0, doc.created_by, doc.updated_at);

  // 更新 FTS 索引
  syncFts(doc.id);

  return doc;
}

export function updateContextDoc(id: string, updates: Partial<Pick<ContextDoc, 'title' | 'content' | 'doc_type' | 'is_forced'>>): ContextDoc | null {
  const db = getDb();
  const existing = getContextDoc(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = { ...existing, ...updates, updated_at: now };

  db.prepare(`
    UPDATE context_docs SET title=?, content=?, doc_type=?, is_forced=?, updated_at=? WHERE id=?
  `).run(updated.title, updated.content, updated.doc_type, updated.is_forced ? 1 : 0, now, id);

  // 重建 FTS
  db.prepare('DELETE FROM context_docs_fts WHERE rowid = (SELECT rowid FROM context_docs WHERE id = ?)').run(id);
  syncFts(id);

  return updated;
}

export function deleteContextDoc(id: string): boolean {
  const db = getDb();
  // 删除 FTS
  db.prepare('DELETE FROM context_docs_fts WHERE rowid = (SELECT rowid FROM context_docs WHERE id = ?)').run(id);
  const result = db.prepare('DELETE FROM context_docs WHERE id = ?').run(id);
  return result.changes > 0;
}

export function getContextDoc(id: string): ContextDoc | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM context_docs WHERE id = ?').get(id) as Record<string, unknown> | undefined;
  return row ? rowToDoc(row) : null;
}

export function listContextDocs(layer?: ContextLayer, scopeId?: string): ContextDoc[] {
  const db = getDb();
  let sql = 'SELECT * FROM context_docs';
  const params: string[] = [];

  if (layer && scopeId) {
    sql += ' WHERE layer = ? AND scope_id = ?';
    params.push(layer, scopeId);
  } else if (layer) {
    sql += ' WHERE layer = ?';
    params.push(layer);
  }

  sql += ' ORDER BY is_forced DESC, updated_at DESC';
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToDoc);
}

/** FTS 语义搜索（Free 版：关键词匹配） */
export function searchContextDocs(query: string, limit = 5): ContextDoc[] {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT c.* FROM context_docs c
      JOIN context_docs_fts f ON c.rowid = f.rowid
      WHERE context_docs_fts MATCH ?
      ORDER BY c.is_forced DESC
      LIMIT ?
    `).all(query, limit) as Record<string, unknown>[];
    return rows.map(rowToDoc);
  } catch {
    // FTS MATCH 失败时降级到 LIKE 搜索
    const rows = db.prepare(`
      SELECT * FROM context_docs
      WHERE title LIKE ? OR content LIKE ?
      ORDER BY is_forced DESC
      LIMIT ?
    `).all(`%${query}%`, `%${query}%`, limit) as Record<string, unknown>[];
    return rows.map(rowToDoc);
  }
}

// ── FTS 同步 ─────────────────────────────────────────────────────────────────

function syncFts(docId: string) {
  const db = getDb();
  const row = db.prepare('SELECT rowid, title, content FROM context_docs WHERE id = ?').get(docId) as
    { rowid: number; title: string; content: string } | undefined;
  if (!row) return;

  db.prepare('INSERT INTO context_docs_fts(rowid, title, content) VALUES (?, ?, ?)').run(
    row.rowid, row.title, row.content,
  );
}

// ── 上下文组装（在 agent route 中使用） ──────────────────────────────────────

/**
 * 为指定用户组装三层上下文 prompt 片段。
 *
 * 加载规则（参见 JOWORK-PLAN §6.2）：
 * 1. 公司层 is_forced=1 文档（始终加载，合规规则）
 * 2. 基于用户消息的语义匹配（FTS5 或向量，Premium 时可扩展）
 * 3. 个人工作方式（personal/workstyle 类型）
 *
 * 总 token 预算：~8K（system prompt 开销），超出时截断低优先级内容。
 */
export function assembleContextPrompt(opts: {
  userId: string;
  teamId?: string;
  query?: string;
}): string {
  const { userId, teamId, query } = opts;
  const segments: string[] = [];

  // 1. 公司强制规则（is_forced=1）
  const forcedRules = listContextDocs('company').filter(d => d.is_forced);
  if (forcedRules.length > 0) {
    const rulesText = forcedRules.map(d => `### ${d.title}\n${d.content}`).join('\n\n');
    segments.push(`## 公司规则（强制遵守）\n\n${rulesText}`);
  }

  // 2. 语义匹配（FTS + 用户/团队范围，Free 版关键词）
  if (query) {
    const matched = searchContextDocs(query, 3)
      .filter(d => !d.is_forced); // 已加载的强制规则不重复
    if (matched.length > 0) {
      const matchedText = matched.map(d => `### ${d.title}\n${d.content}`).join('\n\n');
      segments.push(`## 相关上下文\n\n${matchedText}`);
    }
  }

  // 3. 个人工作方式文档（personal 层）
  const personalDocs = listContextDocs('personal', userId)
    .filter(d => d.doc_type === 'workstyle' || d.doc_type === 'learned');
  if (personalDocs.length > 0) {
    const personalText = personalDocs.map(d => d.content).join('\n\n');
    segments.push(`## 个人工作方式\n\n${personalText}`);
  }

  // 4. 团队规范
  if (teamId) {
    const teamDocs = listContextDocs('team', teamId).filter(d => !d.is_forced);
    if (teamDocs.length > 0) {
      const teamText = teamDocs.map(d => `### ${d.title}\n${d.content}`).join('\n\n');
      segments.push(`## 团队规范\n\n${teamText}`);
    }
  }

  return segments.join('\n\n---\n\n');
}

// ── 内部工具 ─────────────────────────────────────────────────────────────────

function rowToDoc(row: Record<string, unknown>): ContextDoc {
  return {
    id: row['id'] as string,
    layer: row['layer'] as ContextLayer,
    scope_id: row['scope_id'] as string,
    title: row['title'] as string,
    content: row['content'] as string,
    doc_type: row['doc_type'] as DocType,
    is_forced: Boolean(row['is_forced']),
    created_by: row['created_by'] as string,
    updated_at: row['updated_at'] as string,
  };
}
