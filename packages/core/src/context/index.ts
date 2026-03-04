// @jowork/core/context — three-layer context system
//
// Implements:
//   - CRUD for context_docs (personal / team / company layers)
//   - FTS-based context assembly (6.2) — always-on forced docs + FTS top-N
//   - Agent self-learning proposal (6.3) — proposeLearnedDoc
//
// Premium embedding-based search is in @jowork/premium/context/embedding.ts

import type {
  ContextDoc,
  ContextDocId,
  ContextDocType,
  ContextLayer,
  Role,
  SensitivityLevel,
  UserId,
} from '../types.js';
import { getDb } from '../datamap/db.js';
import { generateId, nowISO } from '../utils/index.js';
import { canReadSensitivity } from '../policy/index.js';

// ─── CRUD ────────────────────────────────────────────────────────────────────

export interface CreateContextDocInput {
  layer: ContextLayer;
  scopeId: string;
  title: string;
  content: string;
  docType?: ContextDocType;
  isForced?: boolean;
  sensitivity?: SensitivityLevel;
  createdBy: string;
}

export function createContextDoc(input: CreateContextDocInput): ContextDoc {
  const db = getDb();
  const doc: ContextDoc = {
    id: generateId(),
    layer: input.layer,
    scopeId: input.scopeId,
    title: input.title,
    content: input.content,
    docType: input.docType ?? 'manual',
    isForced: input.isForced ?? false,
    sensitivity: input.sensitivity ?? 'internal',
    createdBy: input.createdBy,
    updatedAt: nowISO(),
  };

  db.prepare(`
    INSERT INTO context_docs (id, layer, scope_id, title, content, doc_type, is_forced, sensitivity, created_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    doc.id, doc.layer, doc.scopeId, doc.title, doc.content,
    doc.docType, doc.isForced ? 1 : 0, doc.sensitivity, doc.createdBy, doc.updatedAt,
  );

  // Sync FTS
  db.prepare(
    `INSERT INTO context_docs_fts(rowid, title, content) SELECT rowid, title, content FROM context_docs WHERE id = ?`,
  ).run(doc.id);

  return doc;
}

export function getContextDoc(id: ContextDocId): ContextDoc | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM context_docs WHERE id = ?`).get(id) as RawRow | undefined;
  return row ? fromRow(row) : null;
}

export interface ListContextDocsOptions {
  layer?: ContextLayer;
  scopeId?: string;
  docType?: ContextDocType;
}

export function listContextDocs(opts: ListContextDocsOptions = {}): ContextDoc[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.layer) { where.push('layer = ?'); params.push(opts.layer); }
  if (opts.scopeId) { where.push('scope_id = ?'); params.push(opts.scopeId); }
  if (opts.docType) { where.push('doc_type = ?'); params.push(opts.docType); }

  const sql = `SELECT * FROM context_docs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC`;
  const rows = db.prepare(sql).all(...params) as RawRow[];
  return rows.map(fromRow);
}

export function updateContextDoc(
  id: ContextDocId,
  patch: Partial<Pick<ContextDoc, 'title' | 'content' | 'isForced'>>,
): ContextDoc {
  const existing = getContextDoc(id);
  if (!existing) throw new Error(`ContextDoc not found: ${id}`);

  const db = getDb();
  const updated: ContextDoc = {
    ...existing,
    ...patch,
    updatedAt: nowISO(),
  };

  db.prepare(`
    UPDATE context_docs SET title = ?, content = ?, is_forced = ?, updated_at = ? WHERE id = ?
  `).run(updated.title, updated.content, updated.isForced ? 1 : 0, updated.updatedAt, updated.id);

  // Rebuild FTS for this row
  db.prepare(`DELETE FROM context_docs_fts WHERE rowid = (SELECT rowid FROM context_docs WHERE id = ?)`).run(id);
  db.prepare(
    `INSERT INTO context_docs_fts(rowid, title, content) SELECT rowid, title, content FROM context_docs WHERE id = ?`,
  ).run(id);

  return updated;
}

export function deleteContextDoc(id: ContextDocId): void {
  const db = getDb();
  // FTS cleanup happens via content table trigger or manual delete
  db.prepare(`DELETE FROM context_docs_fts WHERE rowid = (SELECT rowid FROM context_docs WHERE id = ?)`).run(id);
  db.prepare(`DELETE FROM context_docs WHERE id = ?`).run(id);
}

// ─── Context assembly (6.2) ──────────────────────────────────────────────────

export interface AssembleContextOptions {
  userId: UserId;
  /** Free-text query from the user message — used for FTS matching */
  query: string;
  /** Max number of FTS-matched docs to include (default: 8) */
  topN?: number;
  /**
   * Role of the requesting user — used by Context PEP to filter out docs
   * with sensitivity above the user's clearance. Defaults to 'owner'
   * (personal mode: no restriction).
   */
  userRole?: Role;
}

export interface AssembledContext {
  /** Ready-to-use system prompt fragment — prepend to session system prompt */
  systemFragment: string;
  /** Doc IDs that were included, for observability */
  includedDocIds: string[];
}

/**
 * Assemble context for a chat turn:
 * 1. Always include company-layer forced docs (compliance rules)
 * 2. FTS search for top-N relevant docs across all layers for this user
 * 3. Always include the user's personal workstyle doc
 *
 * Total budget: ~8K tokens (enforced by char-count proxy: 1 token ≈ 4 chars)
 */
export function assembleContext(opts: AssembleContextOptions): AssembledContext {
  const db = getDb();
  const topN = opts.topN ?? 8;
  const MAX_CHARS = 32_000; // ~8K tokens
  const userRole: Role = opts.userRole ?? 'owner';

  const includedDocIds: string[] = [];
  const sections: string[] = [];
  let usedChars = 0;

  function addDoc(doc: ContextDoc, label: string): boolean {
    // Context PEP: skip docs above the user's sensitivity clearance
    if (!canReadSensitivity(userRole, doc.sensitivity)) return false;
    const text = `### ${label}: ${doc.title}\n\n${doc.content}\n`;
    if (usedChars + text.length > MAX_CHARS) return false;
    sections.push(text);
    includedDocIds.push(doc.id);
    usedChars += text.length;
    return true;
  }

  // 1. Forced company-layer rules (always load)
  const forcedDocs = db.prepare(`
    SELECT * FROM context_docs WHERE layer = 'company' AND is_forced = 1
    ORDER BY updated_at DESC
  `).all() as RawRow[];
  for (const row of forcedDocs) addDoc(fromRow(row), 'Company Rule');

  // 2. FTS search across all layers scoped to user
  if (opts.query.trim()) {
    const ftsQuery = opts.query.trim().replace(/['"*]/g, ' ');
    const ftsRows = db.prepare(`
      SELECT cd.* FROM context_docs cd
      JOIN context_docs_fts f ON cd.rowid = f.rowid
      WHERE context_docs_fts MATCH ?
        AND cd.doc_type != 'onboarding_state'
        AND (cd.scope_id = ? OR cd.layer = 'company')
      ORDER BY rank
      LIMIT ?
    `).all(ftsQuery, opts.userId, topN) as RawRow[];

    for (const row of ftsRows) {
      if (!includedDocIds.includes(row.id)) {
        addDoc(fromRow(row), layerLabel(row.layer as ContextLayer));
      }
    }
  }

  // 3. Personal workstyle doc (always load if present)
  const workstyleDoc = db.prepare(`
    SELECT * FROM context_docs
    WHERE scope_id = ? AND doc_type = 'workstyle' AND layer = 'personal'
    ORDER BY updated_at DESC LIMIT 1
  `).get(opts.userId) as RawRow | undefined;

  if (workstyleDoc && !includedDocIds.includes(workstyleDoc.id)) {
    addDoc(fromRow(workstyleDoc), 'My Work Style');
  }

  const systemFragment = sections.length > 0
    ? `## Context\n\n${sections.join('\n')}`
    : '';

  return { systemFragment, includedDocIds };
}

// ─── Agent self-learning (6.3) ───────────────────────────────────────────────

export interface LearnedDocProposal {
  userId: UserId;
  /** Inferred title — presenter will show this to user for confirmation */
  title: string;
  content: string;
}

/**
 * Propose a learned preference doc (6.3 flow).
 * Call this when the agent detects a stable preference in conversation.
 * Returns the proposal — caller must get user confirmation before saving.
 *
 * To actually save, call: createContextDoc({ ..., docType: 'learned', ... })
 */
export function proposeLearnedDoc(
  userId: UserId,
  title: string,
  content: string,
): LearnedDocProposal {
  return { userId, title, content };
}

/** Confirm and persist a learned doc proposal */
export function confirmLearnedDoc(proposal: LearnedDocProposal): ContextDoc {
  return createContextDoc({
    layer: 'personal',
    scopeId: proposal.userId,
    title: proposal.title,
    content: proposal.content,
    docType: 'learned',
    createdBy: 'agent',
  });
}

// ─── Workstyle onboarding helper ─────────────────────────────────────────────

/** Create (or replace) the user's personal workstyle doc during onboarding */
export function saveWorkstyleDoc(userId: UserId, content: string): ContextDoc {
  const db = getDb();
  const existing = db.prepare(`
    SELECT id FROM context_docs WHERE scope_id = ? AND doc_type = 'workstyle' AND layer = 'personal' LIMIT 1
  `).get(userId) as { id: string } | undefined;

  if (existing) {
    return updateContextDoc(existing.id, { content });
  }
  return createContextDoc({
    layer: 'personal',
    scopeId: userId,
    title: 'My Work Style',
    content,
    docType: 'workstyle',
    createdBy: userId,
  });
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface RawRow {
  id: string;
  layer: string;
  scope_id: string;
  title: string;
  content: string;
  doc_type: string;
  is_forced: number;
  sensitivity: string;
  created_by: string;
  updated_at: string;
}

function fromRow(row: RawRow): ContextDoc {
  return {
    id: row.id,
    layer: row.layer as ContextLayer,
    scopeId: row.scope_id,
    title: row.title,
    content: row.content,
    docType: row.doc_type as ContextDocType,
    isForced: row.is_forced === 1,
    sensitivity: (row.sensitivity as SensitivityLevel) ?? 'internal',
    createdBy: row.created_by,
    updatedAt: row.updated_at,
  };
}

function layerLabel(layer: ContextLayer): string {
  switch (layer) {
    case 'company': return 'Company';
    case 'team':    return 'Team';
    case 'personal': return 'Personal';
  }
}
