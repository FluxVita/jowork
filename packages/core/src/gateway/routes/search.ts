// @jowork/core/gateway/routes/search — Global search REST API
//
// Searches across messages, memories, and context docs for the authenticated user.
// All three domains use FTS5 (messages_fts, memories_fts, context_docs_fts),
// with automatic LIKE fallback on FTS5 syntax errors.
//
// Routes:
//   GET /api/search?q=<query>&limit=<n>

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';

export interface SearchResultMessage {
  kind: 'message';
  id: string;
  sessionId: string;
  sessionTitle: string;
  role: string;
  snippet: string;
  createdAt: string;
}

export interface SearchResultMemory {
  kind: 'memory';
  id: string;
  snippet: string;
  tags: string[];
  source: string;
  createdAt: string;
}

export interface SearchResultContext {
  kind: 'context';
  id: string;
  title: string;
  snippet: string;
  layer: string;
  docType: string;
  updatedAt: string;
}

export type SearchResult = SearchResultMessage | SearchResultMemory | SearchResultContext;

export interface SearchResponse {
  query: string;
  messages: SearchResultMessage[];
  memories: SearchResultMemory[];
  context: SearchResultContext[];
}

export function searchRouter(): Router {
  const router = Router();

  router.get('/api/search', authenticate, (req, res, next) => {
    try {
      const q = String(req.query['q'] ?? '').trim();
      const limit = Math.min(Number(req.query['limit'] ?? 10), 50);
      const userId = req.auth!.userId;

      if (!q) {
        res.json({ query: '', messages: [], memories: [], context: [] } satisfies SearchResponse);
        return;
      }

      const db = getDb();
      const likeQ = `%${q}%`;

      // Search messages (FTS5, LIKE fallback on syntax error) — join sessions for ownership + title
      let messages: SearchResultMessage[] = [];
      try {
        const messageRows = db.prepare(`
          SELECT m.id, m.session_id, s.title as session_title, m.role, m.content, m.created_at
          FROM messages m
          JOIN messages_fts f ON m.rowid = f.rowid
          JOIN sessions s ON m.session_id = s.id
          WHERE s.user_id = ? AND messages_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(userId, q, limit) as Array<{
          id: string; session_id: string; session_title: string;
          role: string; content: string; created_at: string;
        }>;
        messages = messageRows.map(r => ({
          kind: 'message',
          id: r.id,
          sessionId: r.session_id,
          sessionTitle: r.session_title,
          role: r.role,
          snippet: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
          createdAt: r.created_at,
        }));
      } catch {
        // FTS5 query syntax error — fall back to LIKE
        const messageRows = db.prepare(`
          SELECT m.id, m.session_id, s.title as session_title, m.role, m.content, m.created_at
          FROM messages m
          JOIN sessions s ON m.session_id = s.id
          WHERE s.user_id = ? AND m.content LIKE ?
          ORDER BY m.created_at DESC
          LIMIT ?
        `).all(userId, likeQ, limit) as Array<{
          id: string; session_id: string; session_title: string;
          role: string; content: string; created_at: string;
        }>;
        messages = messageRows.map(r => ({
          kind: 'message',
          id: r.id,
          sessionId: r.session_id,
          sessionTitle: r.session_title,
          role: r.role,
          snippet: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
          createdAt: r.created_at,
        }));
      }

      // Search memories (FTS5)
      let memories: SearchResultMemory[] = [];
      try {
        const memRows = db.prepare(`
          SELECT m.id, m.content, m.tags, m.source, m.created_at
          FROM memories m
          JOIN memories_fts f ON m.rowid = f.rowid
          WHERE m.user_id = ? AND memories_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(userId, q, limit) as Array<{
          id: string; content: string; tags: string; source: string; created_at: string;
        }>;
        memories = memRows.map(r => ({
          kind: 'memory',
          id: r.id,
          snippet: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
          tags: JSON.parse(r.tags) as string[],
          source: r.source,
          createdAt: r.created_at,
        }));
      } catch {
        // FTS5 query syntax error — fall back to LIKE
        const memRows = db.prepare(`
          SELECT id, content, tags, source, created_at
          FROM memories
          WHERE user_id = ? AND content LIKE ?
          ORDER BY created_at DESC
          LIMIT ?
        `).all(userId, likeQ, limit) as Array<{
          id: string; content: string; tags: string; source: string; created_at: string;
        }>;
        memories = memRows.map(r => ({
          kind: 'memory',
          id: r.id,
          snippet: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
          tags: JSON.parse(r.tags) as string[],
          source: r.source,
          createdAt: r.created_at,
        }));
      }

      // Search context docs (FTS5 on title+content) — scope to user's own docs
      let context: SearchResultContext[] = [];
      try {
        const ctxRows = db.prepare(`
          SELECT c.id, c.title, c.content, c.layer, c.doc_type, c.updated_at
          FROM context_docs c
          JOIN context_docs_fts f ON c.rowid = f.rowid
          WHERE c.created_by = ? AND context_docs_fts MATCH ?
          ORDER BY rank
          LIMIT ?
        `).all(userId, q, limit) as Array<{
          id: string; title: string; content: string;
          layer: string; doc_type: string; updated_at: string;
        }>;
        context = ctxRows.map(r => ({
          kind: 'context',
          id: r.id,
          title: r.title,
          snippet: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
          layer: r.layer,
          docType: r.doc_type,
          updatedAt: r.updated_at,
        }));
      } catch {
        // FTS5 query syntax error — fall back to LIKE
        const ctxRows = db.prepare(`
          SELECT id, title, content, layer, doc_type, updated_at
          FROM context_docs
          WHERE created_by = ? AND (title LIKE ? OR content LIKE ?)
          ORDER BY updated_at DESC
          LIMIT ?
        `).all(userId, likeQ, likeQ, limit) as Array<{
          id: string; title: string; content: string;
          layer: string; doc_type: string; updated_at: string;
        }>;
        context = ctxRows.map(r => ({
          kind: 'context',
          id: r.id,
          title: r.title,
          snippet: r.content.length > 200 ? r.content.slice(0, 200) + '…' : r.content,
          layer: r.layer,
          docType: r.doc_type,
          updatedAt: r.updated_at,
        }));
      }

      res.json({ query: q, messages, memories, context } satisfies SearchResponse);
    } catch (err) { next(err); }
  });

  return router;
}
