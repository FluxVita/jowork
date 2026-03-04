// @jowork/core/gateway/routes/stats — Aggregate stats REST API
//
// Returns only aggregate counts, never per-user details, to protect privacy.
//
// Routes:
//   GET /api/stats — aggregate counts for authenticated user's data

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';

export function statsRouter(): Router {
  const router = Router();

  router.get('/api/stats', authenticate, (req, res, next) => {
    try {
      const db = getDb();
      const userId = req.auth!.userId;

      const sessionCount = (db.prepare(
        `SELECT COUNT(*) as n FROM sessions WHERE user_id = ?`,
      ).get(userId) as { n: number }).n;

      const messageCount = (db.prepare(
        `SELECT COUNT(*) as n FROM messages m
         JOIN sessions s ON m.session_id = s.id
         WHERE s.user_id = ?`,
      ).get(userId) as { n: number }).n;

      const memoryCount = (db.prepare(
        `SELECT COUNT(*) as n FROM memories WHERE user_id = ?`,
      ).get(userId) as { n: number }).n;

      const connectorCount = (db.prepare(
        `SELECT COUNT(*) as n FROM connectors WHERE owner_id = ?`,
      ).get(userId) as { n: number }).n;

      const agentStats = (db.prepare(
        `SELECT a.name as agentName, COUNT(s.id) as sessionCount
         FROM agents a
         LEFT JOIN sessions s ON a.id = s.agent_id AND s.user_id = ?
         WHERE a.owner_id = ?
         GROUP BY a.id, a.name
         ORDER BY sessionCount DESC`,
      ).all(userId, userId) as Array<{ agentName: string; sessionCount: number }>);

      res.json({
        sessions: sessionCount,
        messages: messageCount,
        memories: memoryCount,
        connectors: connectorCount,
        agents: agentStats,
      });
    } catch (err) { next(err); }
  });

  return router;
}
