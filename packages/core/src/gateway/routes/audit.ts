import { Router } from 'express';
import { queryAuditLogs } from '../../audit/logger.js';
import { authMiddleware, requireRole } from '../middleware.js';

const router = Router();

/** GET /api/audit/logs — 查询审计日志 */
router.get('/logs', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const { actor_id, action, from, to, limit } = req.query;

  const logs = queryAuditLogs({
    actor_id: actor_id as string | undefined,
    action: action as string | undefined,
    from: from as string | undefined,
    to: to as string | undefined,
    limit: limit ? parseInt(limit as string, 10) : undefined,
  });

  res.json({ logs, count: logs.length });
});

export default router;
