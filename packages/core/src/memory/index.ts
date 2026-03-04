// @jowork/core/memory — basic memory store (keyword search, no vectors)
// Premium embedding search is in @jowork/premium/memory/embedding.ts

import type { MemoryEntry, MemoryId, SensitivityLevel, UserId } from '../types.js';
import { getDb } from '../datamap/db.js';
import { generateId, nowISO } from '../utils/index.js';

export interface MemorySearchOptions {
  query?: string;
  userId: UserId;
  limit?: number;
}

export function saveMemory(
  userId: UserId,
  content: string,
  opts: { tags?: string[]; source?: string; sensitivity?: SensitivityLevel } = {},
): MemoryEntry {
  const db = getDb();
  const entry: MemoryEntry = {
    id: generateId(),
    userId,
    content,
    tags: opts.tags ?? [],
    source: opts.source ?? 'user',
    sensitivity: opts.sensitivity ?? 'internal',
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };

  db.prepare(`
    INSERT INTO memories (id, user_id, content, tags, source, sensitivity, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entry.id, entry.userId, entry.content, JSON.stringify(entry.tags), entry.source, entry.sensitivity, entry.createdAt, entry.updatedAt);

  // Update FTS index
  db.prepare(`INSERT INTO memories_fts(rowid, content) SELECT rowid, content FROM memories WHERE id = ?`).run(entry.id);

  return entry;
}

export function searchMemory(opts: MemorySearchOptions): MemoryEntry[] {
  const db = getDb();
  const limit = opts.limit ?? 20;

  if (opts.query) {
    // FTS5 keyword search
    const rows = db.prepare(`
      SELECT m.id, m.user_id, m.content, m.tags, m.source, m.created_at, m.updated_at
      FROM memories m
      JOIN memories_fts f ON m.rowid = f.rowid
      WHERE m.user_id = ? AND memories_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(opts.userId, opts.query, limit) as RawMemoryRow[];
    return rows.map(fromRow);
  }

  // Latest memories for user
  const rows = db.prepare(`
    SELECT id, user_id, content, tags, source, created_at, updated_at
    FROM memories
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `).all(opts.userId, limit) as RawMemoryRow[];
  return rows.map(fromRow);
}

export function deleteMemory(id: MemoryId): void {
  const db = getDb();
  db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface RawMemoryRow {
  id: string;
  user_id: string;
  content: string;
  tags: string;
  source: string;
  sensitivity: string;
  created_at: string;
  updated_at: string;
}

function fromRow(row: RawMemoryRow): MemoryEntry {
  return {
    id: row.id,
    userId: row.user_id,
    content: row.content,
    tags: JSON.parse(row.tags) as string[],
    source: row.source,
    sensitivity: (row.sensitivity as SensitivityLevel) ?? 'internal',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
