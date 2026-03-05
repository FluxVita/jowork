// @jowork/core/gateway/routes/sessions — Session + Message management REST API
//
// Routes:
//   GET    /api/sessions              — list current user's sessions
//   POST   /api/sessions              — create a new session
//   GET    /api/sessions/:id          — get session with last 40 messages + hasMore flag
//   PATCH  /api/sessions/:id          — update session title
//   DELETE /api/sessions/:id          — delete session and all its messages
//   PATCH  /api/sessions/:id/messages/:msgId — edit a user message
//   DELETE /api/sessions/:id/messages/:msgId — delete a single message
//   GET    /api/sessions/:id/messages — paginated message history (cursor-based)
//   GET    /api/sessions/:id/export   — export full session as md|json|txt
//   POST   /api/sessions/:id/fork    — fork session (copy messages up to a point)
//   GET    /api/sessions/folders     — list distinct folders
//   PATCH  /api/sessions/folders/:name — rename folder (cascade update all sessions)
//   DELETE /api/sessions/folders/:name — delete folder (set to NULL on all sessions)

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
  pinned: number;
  folder: string | null;
  forked_from: string | null;
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
    pinned: row.pinned === 1,
    folder: row.folder ?? null,
    forkedFrom: row.forked_from ?? null,
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

  // List sessions for the authenticated user (pinned first, then most recently updated)
  // Optional query: ?folder=<name> to filter by folder
  router.get('/api/sessions', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const folder = req.query['folder'] ? String(req.query['folder']) : null;

      let rows: SessionRow[];
      if (folder) {
        rows = db.prepare(
          `SELECT * FROM sessions WHERE user_id = ? AND folder = ? ORDER BY pinned DESC, updated_at DESC`,
        ).all(userId, folder) as SessionRow[];
      } else {
        rows = db.prepare(
          `SELECT * FROM sessions WHERE user_id = ? ORDER BY pinned DESC, updated_at DESC`,
        ).all(userId) as SessionRow[];
      }
      res.json(rows.map(r => rowToSession(r)));
    } catch (err) { next(err); }
  });

  // List distinct folders for the authenticated user
  router.get('/api/sessions/folders', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const rows = db.prepare(
        `SELECT DISTINCT folder FROM sessions WHERE user_id = ? AND folder IS NOT NULL ORDER BY folder`,
      ).all(userId) as Array<{ folder: string }>;
      res.json(rows.map(r => r.folder));
    } catch (err) { next(err); }
  });

  // Rename a folder — cascade update all sessions with the old folder name
  router.patch('/api/sessions/folders/:name', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const oldName = decodeURIComponent(String(req.params['name']));
      const { name: newName } = req.body as { name?: string };

      if (!newName?.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'name is required' });
        return;
      }

      const result = db.prepare(
        `UPDATE sessions SET folder = ?, updated_at = ? WHERE user_id = ? AND folder = ?`,
      ).run(newName.trim(), nowISO(), userId, oldName);

      res.json({ renamed: result.changes, from: oldName, to: newName.trim() });
    } catch (err) { next(err); }
  });

  // Delete a folder — set folder to NULL on all sessions with that folder name
  router.delete('/api/sessions/folders/:name', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const folderName = decodeURIComponent(String(req.params['name']));

      const result = db.prepare(
        `UPDATE sessions SET folder = NULL, updated_at = ? WHERE user_id = ? AND folder = ?`,
      ).run(nowISO(), userId, folderName);

      res.json({ removed: result.changes, folder: folderName });
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
        `INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, forked_from, created_at, updated_at) VALUES (?,?,?,?,0,NULL,NULL,?,?)`,
      ).run(id, aid, userId, title ?? 'New session', now, now);

      res.status(201).json(rowToSession(
        { id, agent_id: aid, user_id: userId, title: title ?? 'New session', pinned: 0, folder: null, forked_from: null, created_at: now, updated_at: now },
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

  // Update session title/pinned/folder — ownership enforced
  router.patch('/api/sessions/:id', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as SessionRow | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const { title, pinned, folder } = req.body as { title?: string; pinned?: boolean; folder?: string | null };

      // At least one field must be provided
      if (title === undefined && pinned === undefined && folder === undefined) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'Provide at least one of: title, pinned, folder' });
        return;
      }

      // Validate title if provided
      if (title !== undefined && !title.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'title cannot be empty' });
        return;
      }

      const now = nowISO();
      const updates: string[] = ['updated_at = ?'];
      const values: unknown[] = [now];

      if (title !== undefined) {
        updates.push('title = ?');
        values.push(title.trim());
      }
      if (pinned !== undefined) {
        updates.push('pinned = ?');
        values.push(pinned ? 1 : 0);
      }
      if (folder !== undefined) {
        updates.push('folder = ?');
        values.push(folder || null);  // empty string → null
      }

      values.push(session.id);
      db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);

      const updated = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(session.id) as SessionRow;
      res.json(rowToSession(updated));
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

  // Edit a user message — ownership checked via session ownership
  router.patch('/api/sessions/:id/messages/:msgId', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as { id: string } | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const msgId = String(req.params['msgId']);
      const msg   = db.prepare(`SELECT id, role, content, rowid FROM messages WHERE id = ? AND session_id = ?`).get(msgId, session.id) as { id: string; role: string; content: string; rowid: number } | undefined;

      if (!msg) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      if (msg.role !== 'user') { res.status(400).json({ error: 'INVALID_INPUT', message: 'Only user messages can be edited' }); return; }

      const { content } = req.body as { content?: string };
      if (!content?.trim()) { res.status(400).json({ error: 'INVALID_INPUT', message: 'content is required' }); return; }

      // FTS5 external content: delete old entry BEFORE updating message (needs old content)
      try {
        db.prepare(`INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', ?, ?)`).run(msg.rowid, msg.content);
      } catch { /* FTS cleanup best-effort */ }

      db.prepare(`UPDATE messages SET content = ? WHERE id = ?`).run(content.trim(), msgId);

      // Re-index with new content
      try {
        db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`).run(msgId);
      } catch { /* FTS update best-effort */ }

      // Update session timestamp
      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(nowISO(), session.id);

      res.json({ id: msgId, content: content.trim() });
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

  // Fork a session — copy messages up to (and including) afterMessageId into a new session
  // POST /api/sessions/:id/fork   body: { afterMessageId?: string }
  // If afterMessageId is omitted, copies all messages.
  router.post('/api/sessions/:id/fork', authenticate, (req, res, next) => {
    try {
      const db      = getDb();
      const userId  = req.auth!.userId;
      const session = db.prepare(
        `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(String(req.params['id']), userId) as SessionRow | undefined;

      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const { afterMessageId } = req.body as { afterMessageId?: string };

      // Get messages to copy
      let messagesToCopy: MessageRow[];
      if (afterMessageId) {
        // Find the target message's created_at, then copy all messages up to and including it
        const target = db.prepare(
          `SELECT created_at FROM messages WHERE id = ? AND session_id = ?`,
        ).get(afterMessageId, session.id) as { created_at: string } | undefined;

        if (!target) { res.status(404).json({ error: 'MESSAGE_NOT_FOUND' }); return; }

        messagesToCopy = db.prepare(
          `SELECT * FROM messages WHERE session_id = ? AND created_at <= ? ORDER BY created_at ASC`,
        ).all(session.id, target.created_at) as MessageRow[];
      } else {
        messagesToCopy = db.prepare(
          `SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC`,
        ).all(session.id) as MessageRow[];
      }

      // Create new session
      const newId = generateId();
      const now   = nowISO();
      const forkTitle = `${session.title} (fork)`;

      db.prepare(
        `INSERT INTO sessions (id, agent_id, user_id, title, pinned, folder, forked_from, created_at, updated_at) VALUES (?,?,?,?,0,?,?,?,?)`,
      ).run(newId, session.agent_id, userId, forkTitle, session.folder, session.id, now, now);

      // Copy messages with new IDs
      const insertMsg = db.prepare(
        `INSERT INTO messages (id, session_id, role, content, tool_calls, tool_results, created_at) VALUES (?,?,?,?,?,?,?)`,
      );
      const insertFts = db.prepare(
        `INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`,
      );

      for (const m of messagesToCopy) {
        const msgId = generateId();
        insertMsg.run(msgId, newId, m.role, m.content, null, null, m.created_at);
        try { insertFts.run(msgId); } catch { /* FTS best-effort */ }
      }

      const newSession = db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(newId) as SessionRow;
      res.status(201).json({
        ...rowToSession(newSession),
        messagesCopied: messagesToCopy.length,
      });
    } catch (err) { next(err); }
  });

  return router;
}
