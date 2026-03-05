import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import { getLogs } from '../../utils/log-buffer.js';
import { getDb } from '../../datamap/db.js';

const router = Router();

/**
 * GET /api/logs
 * 内存日志缓冲区（admin 专用，实时滚动）
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

/**
 * GET /api/logs/mine
 * 个人活动日志：自己的会话列表 + 近期工具调用 + 自己关联的 warn/error
 * 普通用户只能看自己，admin 可通过 ?user_id= 查看任意用户
 */
router.get('/mine', authMiddleware, (req, res) => {
  const db = getDb();
  const isAdmin = ['owner', 'admin'].includes(req.user!.role);
  const targetUserId = (isAdmin && req.query['user_id'])
    ? (req.query['user_id'] as string)
    : req.user!.user_id;

  const days = Math.min(parseInt((req.query['days'] as string) ?? '30', 10), 90);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // 近期会话（含 token 消耗）
  const sessions = db.prepare(`
    SELECT session_id, title, message_count, total_tokens, total_cost, engine, created_at, updated_at
    FROM sessions WHERE user_id = ? AND created_at >= ? AND archived_at IS NULL
    ORDER BY updated_at DESC LIMIT 50
  `).all(targetUserId, since);

  // 近期工具调用记录（来自 session_messages）
  const toolCalls = db.prepare(`
    SELECT sm.id, sm.session_id, sm.tool_name, sm.tool_status, sm.duration_ms,
           sm.cost_usd, sm.tokens, sm.created_at, s.title as session_title
    FROM session_messages sm
    JOIN sessions s ON s.session_id = sm.session_id
    WHERE s.user_id = ? AND sm.role = 'tool_result' AND sm.created_at >= ?
    ORDER BY sm.created_at DESC LIMIT 100
  `).all(targetUserId, since);

  // 个人关联的 warn/error 日志
  const errorLogs = db.prepare(`
    SELECT id, ts, level, component, message, session_id, request_path, duration_ms
    FROM app_logs WHERE user_id = ? AND level IN ('warn','error') AND ts >= ?
    ORDER BY id DESC LIMIT 50
  `).all(targetUserId, since);

  // token 消耗汇总（按天）
  const tokenByDay = db.prepare(`
    SELECT date(sm.created_at) as day,
           SUM(sm.tokens) as tokens, SUM(sm.cost_usd) as cost_usd, COUNT(*) as calls
    FROM session_messages sm
    JOIN sessions s ON s.session_id = sm.session_id
    WHERE s.user_id = ? AND sm.role = 'assistant' AND sm.created_at >= ?
    GROUP BY day ORDER BY day
  `).all(targetUserId, since);

  res.json({ sessions, toolCalls, errorLogs, tokenByDay, days, user_id: targetUserId });
});

export default router;
