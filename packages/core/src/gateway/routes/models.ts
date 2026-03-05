import { Router } from 'express';
import {
  routeModel, getModelCostDashboard,
  getProvidersStatus, updateProviderConfig, updateProviderApiKey,
} from '../../models/router.js';
import { authMiddleware, requireFeishuAuth, requireRole } from '../middleware.js';
import { getDb } from '../../datamap/db.js';
import type { TaskType } from '../../models/router.js';

const router = Router();

/** POST /api/models/chat — 模型对话（需要飞书认证） */
router.post('/chat', authMiddleware, requireFeishuAuth, async (req, res) => {
  const { messages, task_type = 'chat', max_tokens } = req.body as {
    messages: { role: string; content: string }[];
    task_type?: TaskType;
    max_tokens?: number;
  };

  if (!messages?.length) {
    res.status(400).json({ error: 'messages is required' });
    return;
  }

  try {
    const result = await routeModel({
      messages: messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
      taskType: task_type,
      userId: req.user!.user_id,
      maxTokens: max_tokens,
    });

    res.json({
      content: result.content,
      metadata: {
        provider: result.provider,
        model: result.model,
        tokens_in: result.tokens_in,
        tokens_out: result.tokens_out,
        cost_usd: result.cost_usd,
      },
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/models/providers — 列出所有 provider 状态（仅管理员） */
router.get('/providers', authMiddleware, requireRole('admin', 'owner'), (_req, res) => {
  res.json(getProvidersStatus());
});

/** PUT /api/models/providers/:id/config — 更新 provider 启用/优先级（仅管理员） */
router.put('/providers/:id/config', authMiddleware, requireRole('admin', 'owner'), (req, res) => {
  const providerId = req.params['id'] as string;
  const { enabled, priority } = req.body as { enabled?: boolean; priority?: number };

  try {
    updateProviderConfig(providerId, { enabled, priority });
    res.json({ message: 'Provider config updated' });
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

/** PUT /api/models/providers/:id/key — 更新 provider API Key（仅管理员） */
router.put('/providers/:id/key', authMiddleware, requireRole('admin', 'owner'), (req, res) => {
  const providerId = req.params['id'] as string;
  const { key } = req.body as { key: string };

  if (!key || typeof key !== 'string') {
    res.status(400).json({ error: 'key is required' });
    return;
  }

  try {
    updateProviderApiKey(providerId, key);
    res.json({ message: `API key for '${providerId}' saved` });
  } catch (err) {
    res.status(404).json({ error: String(err) });
  }
});

/** GET /api/models/cost — 模型成本看板（管理员） */
router.get('/cost', authMiddleware, requireRole('admin', 'owner'), (_req, res) => {
  const dashboard = getModelCostDashboard();
  res.json(dashboard);
});

/**
 * GET /api/models/usage — 每个用户的 token 用量明细
 * 管理员可看所有人；普通用户只能看自己
 * 支持 ?days=7（默认30天）?user_id=xxx（管理员专用）
 */
router.get('/usage', authMiddleware, (req, res) => {
  const db = getDb();
  const days = Math.min(parseInt(req.query['days'] as string ?? '30'), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  const isAdmin = ['owner', 'admin'].includes(req.user!.role);
  const targetUserId = isAdmin && req.query['user_id']
    ? (req.query['user_id'] as string)
    : req.user!.user_id;

  // 按日期+用户+provider 分组汇总
  const rows = isAdmin && !req.query['user_id']
    ? db.prepare(`
        SELECT mc.user_id, u.name as user_name, mc.provider, mc.model,
               SUM(mc.tokens_in) as tokens_in, SUM(mc.tokens_out) as tokens_out,
               SUM(mc.cost_usd) as cost_usd, COUNT(*) as requests, mc.date
        FROM model_costs mc
        LEFT JOIN users u ON u.user_id = mc.user_id
        WHERE mc.date >= ?
        GROUP BY mc.user_id, mc.provider, mc.model, mc.date
        ORDER BY mc.date DESC, cost_usd DESC
      `).all(since)
    : db.prepare(`
        SELECT mc.user_id, u.name as user_name, mc.provider, mc.model,
               SUM(mc.tokens_in) as tokens_in, SUM(mc.tokens_out) as tokens_out,
               SUM(mc.cost_usd) as cost_usd, COUNT(*) as requests, mc.date
        FROM model_costs mc
        LEFT JOIN users u ON u.user_id = mc.user_id
        WHERE mc.date >= ? AND mc.user_id = ?
        GROUP BY mc.provider, mc.model, mc.date
        ORDER BY mc.date DESC
      `).all(since, targetUserId);

  // 汇总总计
  interface UsageRow { tokens_in: number; tokens_out: number; cost_usd: number; requests: number }
  const totals = (rows as UsageRow[]).reduce((acc, r) => ({
    tokens_in: acc.tokens_in + (r.tokens_in ?? 0),
    tokens_out: acc.tokens_out + (r.tokens_out ?? 0),
    cost_usd: acc.cost_usd + (r.cost_usd ?? 0),
    requests: acc.requests + (r.requests ?? 0),
  }), { tokens_in: 0, tokens_out: 0, cost_usd: 0, requests: 0 });

  res.json({ days, since, rows, totals });
});

export default router;
