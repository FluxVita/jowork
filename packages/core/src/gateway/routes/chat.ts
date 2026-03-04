// @jowork/core/gateway/routes/chat — send message, get reply
// Accepts an optional `dispatchFn` (premium override); defaults to runBuiltin.
//
// Routes:
//   POST /api/sessions/:id/messages         — standard JSON response
//   POST /api/sessions/:id/messages/stream  — SSE streaming response

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';
import { generateId, nowISO } from '../../utils/index.js';
import { NotFoundError } from '../../types.js';
import { runBuiltin } from '../../agent/index.js';
import type { RunOptions, RunResult } from '../../agent/engines/builtin.js';

export type DispatchFn = (opts: RunOptions) => Promise<RunResult>;

/** Helper: load session + agent for the authenticated user */
function loadSession(sessionId: string, userId: string) {
  const db = getDb();
  const session = db.prepare(
    `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
  ).get(sessionId, userId) as { id: string; agent_id: string; user_id: string; title: string } | undefined;
  if (!session) throw new NotFoundError('session');

  const agent = db.prepare(`SELECT id, system_prompt FROM agents WHERE id = ?`).get(session.agent_id) as {
    id: string; system_prompt: string;
  } | undefined;

  const history = (db.prepare(
    `SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 40`,
  ).all(sessionId) as Array<{ id: string; session_id: string; role: string; content: string; created_at: string }>)
    .reverse()
    .map(m => ({ id: m.id, sessionId: m.session_id, role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.created_at }));

  return { session, agent, history };
}

export function chatRouter(dispatchFn?: DispatchFn): Router {
  const router = Router();
  const doDispatch = dispatchFn ?? runBuiltin;

  // ── Standard JSON endpoint ──────────────────────────────────────────────────
  router.post('/api/sessions/:id/messages', authenticate, async (req, res, next) => {
    try {
      const sessionId = String(req.params['id']);
      const userId = req.auth!.userId;
      const { content } = req.body as { content: string };

      if (!content?.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'content is required' });
        return;
      }

      const { session, agent, history } = loadSession(sessionId, userId);
      const systemPrompt = agent?.system_prompt ?? 'You are a helpful AI coworker.';

      const result = await doDispatch({
        sessionId,
        agentId: session.agent_id,
        userId,
        systemPrompt,
        history,
        userMessage: content,
      });

      const db = getDb();
      const now = nowISO();
      const insert = db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`);
      for (const msg of result.messages) {
        insert.run(msg.id ?? generateId(), msg.sessionId, msg.role, msg.content, msg.createdAt ?? now);
      }
      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);

      res.json({ messages: result.messages, turns: result.turnCount });
    } catch (err) { next(err); }
  });

  // ── SSE streaming endpoint (agent-aware: supports tool execution) ───────────
  // Client sends user message; server streams assistant reply as SSE events:
  //   data: {"type":"chunk","text":"..."}\n\n     — text delta (real-time)
  //   data: {"type":"done","messageId":"..."}\n\n  — final event with message ID
  //   data: {"type":"error","message":"..."}\n\n   — on error
  //
  // Text chunks are emitted character-by-character (Anthropic native streaming).
  // Tool execution happens transparently between turns; no tool events are emitted
  // to keep the protocol simple and backwards compatible.
  router.post('/api/sessions/:id/messages/stream', authenticate, async (req, res, next) => {
    try {
      const sessionId = String(req.params['id']);
      const userId = req.auth!.userId;
      const { content } = req.body as { content: string };

      if (!content?.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'content is required' });
        return;
      }

      const { session, agent, history } = loadSession(sessionId, userId);
      const systemPrompt = agent?.system_prompt ?? 'You are a helpful AI coworker.';

      // Set up SSE headers before running the agent loop
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      // Run agent loop with streaming chunks written directly to SSE
      let result;
      try {
        result = await doDispatch({
          sessionId,
          agentId: session.agent_id,
          userId,
          systemPrompt,
          history,
          userMessage: content,
          onChunk: (text) => {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
          },
        });
      } catch (agentErr) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: String(agentErr) })}\n\n`);
        res.end();
        return;
      }

      // Persist all messages from the agent loop
      const db = getDb();
      const now = nowISO();
      const insert = db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`);
      for (const msg of result.messages) {
        insert.run(msg.id ?? generateId(), msg.sessionId, msg.role, msg.content, msg.createdAt ?? now);
      }
      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);

      const assistantMsgs = result.messages.filter(m => m.role === 'assistant');
      const assistantMsg = assistantMsgs[assistantMsgs.length - 1];
      res.write(`data: ${JSON.stringify({ type: 'done', messageId: assistantMsg?.id ?? generateId() })}\n\n`);
      res.end();
    } catch (err) { next(err); }
  });

  return router;
}
