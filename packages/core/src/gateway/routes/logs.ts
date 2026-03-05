import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import { getLogs } from '../../utils/log-buffer.js';

const router = Router();

/**
 * GET /api/logs
 * 返回内存日志缓冲区，仅 admin/owner 可访问。
 * Query params:
 *   level  = all | info | warn | error  (默认 all)
 *   q      = 关键词搜索
 *   limit  = 最多返回条数（默认 300，最大 1000）
 *   after  = 仅返回 id > after 的条目（用于增量轮询）
 */
router.get('/', authMiddleware, requireRole('admin', 'owner'), (req, res) => {
  const level  = (req.query['level'] as string) ?? 'all';
  const q      = (req.query['q'] as string) ?? '';
  const limit  = Math.min(parseInt((req.query['limit'] as string) ?? '300', 10), 1000);
  const after  = req.query['after'] !== undefined
    ? parseInt(req.query['after'] as string, 10)
    : undefined;

  const entries = getLogs({ level: level || 'all', q: q || undefined, limit, after });
  res.json({ entries, total: entries.length });
});

export default router;
