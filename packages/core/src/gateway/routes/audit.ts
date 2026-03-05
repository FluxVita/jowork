// @jowork/core/gateway/routes/audit — audit log query endpoints
//
// Routes:
//   GET    /api/audit                — query audit log entries (with filters)
//   DELETE /api/audit/purge          — delete entries older than ?before= date

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { queryAuditLog, purgeAuditBefore } from '../../audit/index.js';

export function auditRouter(): Router {
  const router = Router();

  /** Query audit log with optional filters */
  router.get('/api/audit', authenticate, requireRole('admin'), (req, res, next) => {
    try {
      const { userId, action, resourceType, since, until, limit, offset } = req.query as Record<string, string | undefined>;
      const q: Record<string, unknown> = {};
      if (userId) q['userId'] = userId;
      if (action) q['action'] = action;
      if (resourceType) q['resourceType'] = resourceType;
      if (since) q['since'] = since;
      if (until) q['until'] = until;
      if (limit) q['limit'] = parseInt(limit, 10);
      if (offset) q['offset'] = parseInt(offset, 10);
      const result = queryAuditLog(q as import('../../audit/index.js').AuditQuery);
      res.json(result);
    } catch (err) { next(err); }
  });

  /** Purge old audit entries (retention management) */
  router.delete('/api/audit/purge', authenticate, requireRole('owner'), (req, res, next) => {
    try {
      const before = req.query['before'] as string | undefined;
      if (!before) {
        res.status(400).json({ message: 'before query param is required (ISO date)' });
        return;
      }
      const deleted = purgeAuditBefore(before);
      res.json({ deleted });
    } catch (err) { next(err); }
  });

  return router;
}
