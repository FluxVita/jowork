// @jowork/core/gateway/routes/feedback — message feedback (thumbs up/down)
//
// Routes:
//   GET    /api/sessions/:id/feedback                   — get all feedback for a session
//   POST   /api/sessions/:id/messages/:msgId/feedback   — submit/update feedback
//   GET    /api/sessions/:id/messages/:msgId/feedback    — get feedback for a message
//   DELETE /api/sessions/:id/messages/:msgId/feedback    — remove feedback

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';
import { generateId, nowISO } from '../../utils/index.js';

export function feedbackRouter(): Router {
  const router = Router();

  // Get all feedback for a session (batch endpoint to avoid N+1 queries)
  router.get('/api/sessions/:id/feedback', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const sessionId = String(req.params['id']);

      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(sessionId, userId) as { id: string } | undefined;
      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const rows = db.prepare(
        `SELECT mf.message_id, mf.rating FROM message_feedback mf
         JOIN messages m ON m.id = mf.message_id
         WHERE m.session_id = ? AND mf.user_id = ?`,
      ).all(sessionId, userId) as Array<{ message_id: string; rating: string }>;

      // Return as a map: { messageId: rating }
      const feedbackMap: Record<string, string> = {};
      for (const row of rows) {
        feedbackMap[row.message_id] = row.rating;
      }
      res.json(feedbackMap);
    } catch (err) { next(err); }
  });

  // Submit or update feedback for a message
  router.post('/api/sessions/:id/messages/:msgId/feedback', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const sessionId = String(req.params['id']);
      const msgId = String(req.params['msgId']);

      // Verify session ownership
      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(sessionId, userId) as { id: string } | undefined;
      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      // Verify message belongs to session
      const msg = db.prepare(
        `SELECT id, role FROM messages WHERE id = ? AND session_id = ?`,
      ).get(msgId, sessionId) as { id: string; role: string } | undefined;
      if (!msg) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      if (msg.role !== 'assistant') {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'can only rate assistant messages' });
        return;
      }

      const { rating, comment } = req.body as { rating: string; comment?: string };
      if (rating !== 'positive' && rating !== 'negative') {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'rating must be positive or negative' });
        return;
      }

      const now = nowISO();

      // Upsert: try INSERT, on conflict UPDATE
      const existing = db.prepare(
        `SELECT id FROM message_feedback WHERE message_id = ? AND user_id = ?`,
      ).get(msgId, userId) as { id: string } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE message_feedback SET rating = ?, comment = ?, created_at = ? WHERE id = ?`,
        ).run(rating, comment ?? null, now, existing.id);
        res.json({ id: existing.id, messageId: msgId, rating, comment: comment ?? null, createdAt: now });
      } else {
        const id = generateId();
        db.prepare(
          `INSERT INTO message_feedback (id, message_id, user_id, rating, comment, created_at) VALUES (?,?,?,?,?,?)`,
        ).run(id, msgId, userId, rating, comment ?? null, now);
        res.status(201).json({ id, messageId: msgId, rating, comment: comment ?? null, createdAt: now });
      }
    } catch (err) { next(err); }
  });

  // Get feedback for a message
  router.get('/api/sessions/:id/messages/:msgId/feedback', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const sessionId = String(req.params['id']);
      const msgId = String(req.params['msgId']);

      // Verify session ownership
      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(sessionId, userId) as { id: string } | undefined;
      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const feedback = db.prepare(
        `SELECT id, message_id, rating, comment, created_at FROM message_feedback WHERE message_id = ? AND user_id = ?`,
      ).get(msgId, userId) as { id: string; message_id: string; rating: string; comment: string | null; created_at: string } | undefined;

      if (!feedback) { res.json(null); return; }

      res.json({
        id: feedback.id,
        messageId: feedback.message_id,
        rating: feedback.rating,
        comment: feedback.comment,
        createdAt: feedback.created_at,
      });
    } catch (err) { next(err); }
  });

  // Delete feedback for a message
  router.delete('/api/sessions/:id/messages/:msgId/feedback', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;
      const sessionId = String(req.params['id']);
      const msgId = String(req.params['msgId']);

      // Verify session ownership
      const session = db.prepare(
        `SELECT id FROM sessions WHERE id = ? AND user_id = ?`,
      ).get(sessionId, userId) as { id: string } | undefined;
      if (!session) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      db.prepare(
        `DELETE FROM message_feedback WHERE message_id = ? AND user_id = ?`,
      ).run(msgId, userId);

      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
