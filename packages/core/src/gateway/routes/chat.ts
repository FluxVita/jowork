// @jowork/core/gateway/routes/chat — send message, get reply
// Accepts an optional `dispatchFn` (premium override); defaults to runBuiltin.
//
// Routes:
//   POST /api/sessions/:id/messages                    — standard JSON response
//   POST /api/sessions/:id/messages/stream             — SSE streaming response
//   POST /api/sessions/:id/messages/:msgId/regenerate  — delete + re-run via SSE

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';
import { generateId, nowISO } from '../../utils/index.js';
import { NotFoundError } from '../../types.js';
import { runBuiltin } from '../../agent/index.js';
import { assembleContext } from '../../context/index.js';
import type { RunOptions, RunResult } from '../../agent/engines/builtin.js';

export type DispatchFn = (opts: RunOptions) => Promise<RunResult>;

const AUTO_TITLE_PLACEHOLDER = 'New chat';
const AUTO_TITLE_MAX_LEN = 50;

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

/** Auto-generate title from first user message text (max AUTO_TITLE_MAX_LEN chars). */
function buildAutoTitle(userMessage: string): string {
  const trimmed = userMessage.trim().replace(/\s+/g, ' ');
  return trimmed.length > AUTO_TITLE_MAX_LEN
    ? trimmed.slice(0, AUTO_TITLE_MAX_LEN).trimEnd() + '…'
    : trimmed;
}

/**
 * If session title is still the placeholder AND there were no messages before this exchange,
 * updates the title and returns the new title; otherwise returns null.
 */
function maybeAutoTitle(
  sessionId: string,
  currentTitle: string,
  historyLengthBefore: number,
  userMessage: string,
  now: string,
): string | null {
  if (currentTitle !== AUTO_TITLE_PLACEHOLDER) return null;
  if (historyLengthBefore > 0) return null;
  const newTitle = buildAutoTitle(userMessage);
  getDb().prepare(`UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?`).run(newTitle, now, sessionId);
  return newTitle;
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
      const historyLengthBefore = history.length;

      // Assemble three-layer context and prepend to system prompt
      let systemPrompt = agent?.system_prompt ?? 'You are a helpful AI coworker.';
      try {
        const ctx = assembleContext({ userId, query: content });
        if (ctx.systemFragment) systemPrompt = `${ctx.systemFragment}\n\n${systemPrompt}`;
      } catch { /* context assembly is best-effort — never block the chat */ }

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
      const insertFts = db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`);
      for (const msg of result.messages) {
        const id = msg.id ?? generateId();
        insert.run(id, msg.sessionId, msg.role, msg.content, msg.createdAt ?? now);
        insertFts.run(id);
      }
      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);

      const newTitle = maybeAutoTitle(sessionId, session.title, historyLengthBefore, content, now);
      res.json({ messages: result.messages, turns: result.turnCount, ...(newTitle ? { newTitle } : {}) });
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
      const historyLengthBefore = history.length;

      // Assemble three-layer context and prepend to system prompt
      let systemPrompt = agent?.system_prompt ?? 'You are a helpful AI coworker.';
      try {
        const ctx = assembleContext({ userId, query: content });
        if (ctx.systemFragment) systemPrompt = `${ctx.systemFragment}\n\n${systemPrompt}`;
      } catch { /* context assembly is best-effort — never block the chat */ }

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
      const insertFts = db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`);
      for (const msg of result.messages) {
        const id = msg.id ?? generateId();
        insert.run(id, msg.sessionId, msg.role, msg.content, msg.createdAt ?? now);
        insertFts.run(id);
      }
      db.prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`).run(now, sessionId);

      const newTitle = maybeAutoTitle(sessionId, session.title, historyLengthBefore, content, now);
      const assistantMsgs = result.messages.filter(m => m.role === 'assistant');
      const assistantMsg = assistantMsgs[assistantMsgs.length - 1];
      res.write(`data: ${JSON.stringify({ type: 'done', messageId: assistantMsg?.id ?? generateId(), ...(newTitle ? { newTitle } : {}) })}\n\n`);
      res.end();
    } catch (err) { next(err); }
  });

  // ── Regenerate endpoint — delete assistant message + re-run via SSE ────────
  // Finds the assistant message, locates the preceding user message,
  // deletes the assistant message (and any messages after it),
  // then re-dispatches with the same user message using SSE streaming.
  router.post('/api/sessions/:id/messages/:msgId/regenerate', authenticate, async (req, res, next) => {
    try {
      const sessionId = String(req.params['id']);
      const msgId = String(req.params['msgId']);
      const userId = req.auth!.userId;

      const db = getDb();

      // Verify session ownership
      const session = db.prepare(
        `SELECT * FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(sessionId, userId) as { id: string; agent_id: string; user_id: string; title: string } | undefined;
      if (!session) throw new NotFoundError('session');

      // Find the target message
      const targetMsg = db.prepare(
        `SELECT id, role, content, created_at FROM messages WHERE id = ? AND session_id = ?`,
      ).get(msgId, sessionId) as { id: string; role: string; content: string; created_at: string } | undefined;
      if (!targetMsg) throw new NotFoundError('message');
      if (targetMsg.role !== 'assistant') {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'can only regenerate assistant messages' });
        return;
      }

      // Find the user message that preceded this assistant message
      const precedingUserMsg = db.prepare(
        `SELECT id, content FROM messages WHERE session_id = ? AND role = 'user' AND created_at <= ? ORDER BY created_at DESC LIMIT 1`,
      ).get(sessionId, targetMsg.created_at) as { id: string; content: string } | undefined;
      if (!precedingUserMsg) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'no preceding user message found' });
        return;
      }

      // Delete the target assistant message and any messages after it
      // Also clean up FTS entries
      const toDelete = db.prepare(
        `SELECT rowid, id FROM messages WHERE session_id = ? AND created_at >= ?`,
      ).all(sessionId, targetMsg.created_at) as Array<{ rowid: number; id: string }>;

      for (const row of toDelete) {
        db.prepare(`DELETE FROM messages_fts WHERE rowid = ?`).run(row.rowid);
        db.prepare(`DELETE FROM messages WHERE id = ?`).run(row.id);
      }

      // Load agent and remaining history (up to the user message, inclusive)
      const agent = db.prepare(`SELECT id, system_prompt FROM agents WHERE id = ?`).get(session.agent_id) as {
        id: string; system_prompt: string;
      } | undefined;

      const history = (db.prepare(
        `SELECT id, session_id, role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 40`,
      ).all(sessionId) as Array<{ id: string; session_id: string; role: string; content: string; created_at: string }>)
        .reverse()
        .map(m => ({ id: m.id, sessionId: m.session_id, role: m.role as 'user' | 'assistant', content: m.content, createdAt: m.created_at }));

      // Remove the last user message from history since it will be passed as userMessage
      const historyWithoutLast = history.filter(m => m.id !== precedingUserMsg.id);

      // Assemble context
      let systemPrompt = agent?.system_prompt ?? 'You are a helpful AI coworker.';
      try {
        const ctx = assembleContext({ userId, query: precedingUserMsg.content });
        if (ctx.systemFragment) systemPrompt = `${ctx.systemFragment}\n\n${systemPrompt}`;
      } catch { /* best-effort */ }

      // Set up SSE
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      let result;
      try {
        result = await doDispatch({
          sessionId,
          agentId: session.agent_id,
          userId,
          systemPrompt,
          history: historyWithoutLast,
          userMessage: precedingUserMsg.content,
          onChunk: (text) => {
            res.write(`data: ${JSON.stringify({ type: 'chunk', text })}\n\n`);
          },
        });
      } catch (agentErr) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: String(agentErr) })}\n\n`);
        res.end();
        return;
      }

      // Persist new messages (only the assistant response, user message is already in DB)
      const now = nowISO();
      const insert = db.prepare(`INSERT INTO messages (id, session_id, role, content, created_at) VALUES (?,?,?,?,?)`);
      const insertFts = db.prepare(`INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages WHERE id = ?`);
      for (const msg of result.messages) {
        if (msg.role === 'user') continue; // user message already exists
        const id = msg.id ?? generateId();
        insert.run(id, msg.sessionId, msg.role, msg.content, msg.createdAt ?? now);
        insertFts.run(id);
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
