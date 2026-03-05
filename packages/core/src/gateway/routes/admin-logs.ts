/**
 * GET /api/admin/logs — 管理员持久化日志查询
 * 从 app_logs 表查询（不依赖内存缓冲，重启不丢失）
 */
import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import { queryAppLogs } from '../../utils/app-logger.js';
import { getDb } from '../../datamap/db.js';

const router = Router();

/**
 * GET /api/admin/logs
 * Query: level, component, user_id, session_id, from, to, q, limit, offset
 */
router.get('/', authMiddleware, requireRole('admin', 'owner'), (req, res) => {
  const {
    level, component, user_id, session_id,
    from, to, q,
    limit: limitStr, offset: offsetStr,
  } = req.query as Record<string, string>;

  const result = queryAppLogs({
    level:      level || 'all',
    component:  component || undefined,
    user_id:    user_id || undefined,
    session_id: session_id || undefined,
    from:       from || undefined,
    to:         to || undefined,
    q:          q || undefined,
    limit:      limitStr ? Math.min(parseInt(limitStr, 10), 1000) : 200,
    offset:     offsetStr ? parseInt(offsetStr, 10) : 0,
  });

  res.json(result);
});

/**
 * GET /api/admin/logs/stats
 * 最近 24h 各级别计数 + 最活跃组件
 */
router.get('/stats', authMiddleware, requireRole('admin', 'owner'), (_req, res) => {
  const db = getDb();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const levelCounts = db.prepare(`
    SELECT level, COUNT(*) as n FROM app_logs WHERE ts >= ? GROUP BY level
  `).all(since) as { level: string; n: number }[];

  const topComponents = db.prepare(`
    SELECT component, COUNT(*) as n FROM app_logs WHERE ts >= ? GROUP BY component ORDER BY n DESC LIMIT 10
  `).all(since) as { component: string; n: number }[];

  const errTrend = db.prepare(`
    SELECT strftime('%H', ts) as hour, COUNT(*) as n
    FROM app_logs WHERE ts >= ? AND level = 'error'
    GROUP BY hour ORDER BY hour
  `).all(since) as { hour: string; n: number }[];

  res.json({ levelCounts, topComponents, errTrend });
});

export default router;
