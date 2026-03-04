// @jowork/core/gateway/routes/chat — send message, get reply
// Accepts an optional `dispatchFn` (premium override); defaults to runBuiltin.

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';
import { generateId, nowISO } from '../../utils/index.js';
import { NotFoundError } from '../../types.js';
import { runBuiltin } from '../../agent/index.js';
import type { RunOptions, RunResult } from '../../agent/engines/builtin.js';

export type DispatchFn = (opts: RunOptions) => Promise<RunResult>;

export function chatRouter(dispatchFn?: DispatchFn): Router {
  const router = Router();
  const doDispatch = dispatchFn ?? runBuiltin;

  router.post('/api/sessions/:id/messages', authenticate, async (req, res, next) => {
    try {
      const db = getDb();
      const sessionId = String(req.params['id']);
      const userId = req.auth!.userId;
      const { content } = req.body as { content: string };

      if (!content?.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'content is required' });
        return;
      }

      const session = db.prepare(`SELECT * FROM sessions WHERE id = ? AND user_id = ?`).get(sessionId, userId) as {
        id: string; agent_id: string; user_id: string; title: string;
      } | undefined;
      if (!session) throw new NotFoundError('session');

      const agent = db.prepare(`SELECT * FROM agents WHERE id = ?`).get(session.agent_id) as {
        id: string; system_prompt: string;
      } | undefined;

      // Load recent message history (last 40 messages)
      const history = (db.prepare(
        `SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 40`,
      ).all(sessionId) as Array<{ id: string; session_id: string; role: string; content: string; created_at: string }>)
        .reverse()
        .map(m => ({ id: m.id, sessionId: m.session_id, role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.created_at }));

      const systemPrompt = agent?.system_prompt ?? 'You are a helpful AI coworker.';

      const result = await doDispatch({
        sessionId,
        agentId: session.agent_id,
        userId,
        systemPrompt,
        history,
        userMessage: content,
      });

      const now = nowISO();
      const insert = db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`);
      for (const msg of result.messages) {
        insert.run(msg.id ?? generateId(), msg.sessionId, msg.role, msg.content, msg.createdAt ?? now);
      }
      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);

      res.json({ messages: result.messages, turns: result.turnCount });
    } catch (err) { next(err); }
  });

  return router;
}
