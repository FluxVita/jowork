// apps/fluxvita — session management routes (same as jowork, uses @jowork/core)

import { Router } from 'express';
import { getDb, generateId, nowISO, authenticate } from '@jowork/core';
import type { AgentSession } from '@jowork/core';

export function sessionsRouter(): Router {
  const router = Router();

  router.get('/api/sessions', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const rows = db.prepare(
        `SELECT id, agent_id, user_id, title, created_at, updated_at FROM sessions WHERE user_id = ? ORDER BY updated_at DESC`,
      ).all(userId) as Array<{ id: string; agent_id: string; user_id: string; title: string; created_at: string; updated_at: string }>;
      res.json(rows.map(r => ({
        id: r.id, agentId: r.agent_id, userId: r.user_id,
        title: r.title, createdAt: r.created_at, updatedAt: r.updated_at, messages: [],
      } satisfies AgentSession)));
    } catch (err) { next(err); }
  });

  router.post('/api/sessions', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const { agentId, title } = req.body as { agentId?: string; title?: string };
      const id = generateId();
      const now = nowISO();
      let aid = agentId;
      if (!aid) {
        const agent = db.prepare(`SELECT id FROM agents WHERE owner_id = ? LIMIT 1`).get(userId) as { id: string } | undefined;
        aid = agent?.id ?? 'default';
      }
      db.prepare(`INSERT INTO sessions (id, agent_id, user_id, title, created_at, updated_at) VALUES (?,?,?,?,?,?)`)
        .run(id, aid, userId, title ?? 'New session', now, now);
      res.status(201).json({ id, agentId: aid, userId, title: title ?? 'New session', createdAt: now, updatedAt: now, messages: [] });
    } catch (err) { next(err); }
  });

  // Get session with messages — enforces ownership (cross-user protection)
  router.get('/api/sessions/:id', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      // Include user_id in WHERE clause to prevent cross-user access
      const session = db.prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`).get(String(req.params['id']), userId) as { id: string; agent_id: string; user_id: string; title: string; created_at: string; updated_at: string } | undefined;
      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      const messages = db.prepare(`SELECT * FROM messages WHERE session_id = ? ORDER BY created_at`).all(session.id) as Array<{ id: string; session_id: string; role: string; content: string; created_at: string }>;
      res.json({
        id: session.id, agentId: session.agent_id, userId: session.user_id,
        title: session.title, createdAt: session.created_at, updatedAt: session.updated_at,
        messages: messages.map(m => ({ id: m.id, sessionId: m.session_id, role: m.role, content: m.content, createdAt: m.created_at })),
      });
    } catch (err) { next(err); }
  });

  return router;
}
