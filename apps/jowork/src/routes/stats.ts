// apps/jowork — aggregate stats route
// Returns only aggregate counts, never per-user details, to protect privacy.

import { Router } from 'express';
import { getDb, authenticate } from '@jowork/core';

export function statsRouter(): Router {
  const router = Router();

  /**
   * GET /api/stats
   * Returns aggregate counts for the authenticated user's data.
   * No individual message content, no other users' data.
   */
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

      // Aggregate tool usage by session count per agent — no user-identifiable detail
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
