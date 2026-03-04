// @jowork/core/gateway/routes/sessions — Session + Message management REST API
//
// Routes:
//   GET    /api/sessions              — list current user's sessions
//   POST   /api/sessions              — create a new session
//   GET    /api/sessions/:id          — get session with last 40 messages + hasMore flag
//   PATCH  /api/sessions/:id          — update session title
//   DELETE /api/sessions/:id          — delete session and all its messages
//   DELETE /api/sessions/:id/messages/:msgId — delete a single message
//   GET    /api/sessions/:id/messages — paginated message history (cursor-based)
//   GET    /api/sessions/:id/export   — export full session as md|json|txt

const PAGE_SIZE = 40;

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';
import { generateId, nowISO } from '../../utils/index.js';
import type { AgentSession } from '../../types.js';

interface SessionRow {
  id: string;
  agent_id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

function rowToSession(row: SessionRow, messages: MessageRow[] = []): AgentSession {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messages: messages.map(m => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role as 'user' | 'assistant',
      content: m.content,
      createdAt: m.created_at,
    })),
  };
}

export function sessionsRouter(): Router {
  const router = Router();

  // List sessions for the authenticated user (most recently updated first)
  router.get('/api/sessions', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const rows = db.prepare(
        `SELECT id, agent_id, user_id, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
      ).all(userId) as SessionRow[];
      res.json(rows.map(r => rowToSession(r)));
    } catch (err) { next(err); }
  });

  // Create a new session for the authenticated user
  router.post('/api/sessions', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const { agentId, title } = req.body as { agentId?: string; title?: string };

      const id  = generateId();
      const now = nowISO();

      // Use provided agentId, or fall back to user's first agent, or 'default'
      let aid = agentId;
      if (!aid) {
        const agent = db.prepare(`SELECT id FROM agents WHERE owner_id = ? LIMIT 1`).get(userId) as { id: string } | undefined;
        aid = agent?.id ?? 'default';
      }

      db.prepare(
        `INSERT INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
      ).run(id, aid, userId, title ?? 'New session', now, now);

      res.status(201).json(rowToSession(
        { id, agent_id: aid, user_id: userId, title: title ?? 'New session', created_at: now, updated_at: now },
      ));
    } catch (err) { next(err); }
  });

  // Get a single session with its last PAGE_SIZE messages + hasMore flag — ownership enforced
  router.get('/api/sessions/:id', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as SessionRow | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      // Fetch one extra to determine hasMore
      const rows = db.prepare(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
      ).all(session.id, PAGE_SIZE + 1) as MessageRow[];

      const hasMore = rows.length > PAGE_SIZE;
      const messages = rows.slice(0, PAGE_SIZE).reverse();
      const nextCursor = hasMore ? messages[0]?.id ?? null : null;

      res.json({ ...rowToSession(session, messages), hasMore, nextCursor });
    } catch (err) { next(err); }
  });

  // Cursor-based message pagination — GET /api/sessions/:id/messages?before=<msgId>&limit=<n>
  // Returns messages older than `before` (exclusive), newest-first within the page, reversed for display.
  router.get('/api/sessions/:id/messages', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as { id: string } | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const rawLimit = parseInt(String(req.query['limit'] ?? PAGE_SIZE), 10);
      const limit    = Number.isNaN(rawLimit) || rawLimit < 1 ? PAGE_SIZE : Math.min(rawLimit, 100);
      const before   = req.query['before'] ? String(req.query['before']) : null;

      let rows: MessageRow[];
      if (before) {
        // Find the created_at of the cursor message, then fetch older ones
        const cursor = db.prepare(
          `SELECT created_at FROM messages WHERE id = ? AND session_id = ?`,
        ).get(before, session.id) as { created_at: string } | undefined;

        if (!cursor) { res.status(404).json({ error: 'CURSOR_NOT_FOUND' }); return; }

        // Fetch limit+1 to detect hasMore
        rows = db.prepare(
          `SELECT * FROM messages WHERE session_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?`,
        ).all(session.id, cursor.created_at, limit + 1) as MessageRow[];
      } else {
        rows = db.prepare(
          `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`,
        ).all(session.id, limit + 1) as MessageRow[];
      }

      const hasMore = rows.length > limit;
      const page    = rows.slice(0, limit).reverse();
      const nextCursor = hasMore ? page[0]?.id ?? null : null;

      res.json({
        messages: page.map(m => ({
          id: m.id,
          sessionId: m.session_id,
          role: m.role as 'user' | 'assistant',
          content: m.content,
          createdAt: m.created_at,
        })),
        hasMore,
        nextCursor,
      });
    } catch (err) { next(err); }
  });

  // Update session title — ownership enforced
  router.patch('/api/sessions/:id', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as SessionRow | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const { title } = req.body as { title?: string };
      if (!title?.trim()) { res.status(400).json({ error: 'INVALID_INPUT', message: 'title is required' }); return; }

      const now = nowISO();
      db.prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(title.trim(), now, session.id);

      res.json({ ...rowToSession(session), title: title.trim(), updatedAt: now });
    } catch (err) { next(err); }
  });

  // Delete a session and cascade-delete all its messages — ownership enforced
  router.delete('/api/sessions/:id', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as { id: string } | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      // Cascade: delete messages first, then the session
      db.prepare(`DELETE FROM messages WHERE session_id = ?`).run(session.id);
      db.prepare(`DELETE FROM sessions WHERE id = ?`).run(session.id);

      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Delete a single message — ownership checked via session ownership
  router.delete('/api/sessions/:id/messages/:msgId', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as { id: string } | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const msgId = String(req.params['msgId']);
      const msg   = db.prepare(`SELECT id FROM messages WHERE id = ? AND session_id = ?`).get(msgId, session.id) as { id: string } | undefined;

      if (!msg) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      db.prepare(`DELETE FROM messages WHERE id = ?`).run(msgId);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  // Export full session as markdown, JSON, or plain text — ownership enforced
  // GET /api/sessions/:id/export?format=md|json|txt  (default: md)
  router.get('/api/sessions/:id/export', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as SessionRow | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const messages = db.prepare(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
      ).all(session.id) as MessageRow[];

      const fmt = String(req.query['format'] ?? 'md').toLowerCase();
      const safe = session.title.replace(/[^a-z0-9_-]/gi, '_').slice(0, 60);
      const filename = `${safe}_${session.id.slice(0, 8)}`;

      if (fmt === 'json') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.json({
          session: {
            id: session.id,
            title: session.title,
            createdAt: session.created_at,
            updatedAt: session.updated_at,
          },
          messages: messages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            createdAt: m.created_at,
          })),
        });
        return;
      }

      if (fmt === 'txt') {
        const lines: string[] = [
          `Session: ${session.title}`,
          `Created: ${session.created_at}`,
          `Messages: ${messages.length}`,
          '',
          '---',
          '',
        ];
        for (const m of messages) {
          lines.push(`[${m.role === 'user' ? 'User' : 'Assistant'}] ${m.created_at}`);
          lines.push(m.content);
          lines.push('');
        }
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.txt"`);
        res.send(lines.join('\n'));
        return;
      }

      // Default: markdown
      const lines: string[] = [
        `# ${session.title}`,
        '',
        `*Created: ${session.created_at} | Messages: ${messages.length}*`,
        '',
        '---',
        '',
      ];
      for (const m of messages) {
        const speaker = m.role === 'user' ? '**User**' : '**Assistant**';
        lines.push(`${speaker} *(${m.created_at})*`);
        lines.push('');
        lines.push(m.content);
        lines.push('');
        lines.push('---');
        lines.push('');
      }
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.md"`);
      res.send(lines.join('\n'));
    } catch (err) { next(err); }
  });

  return router;
}
