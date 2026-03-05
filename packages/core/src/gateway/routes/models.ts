import { Router } from 'express';
import {
  routeModel, getModelCostDashboard,
  getProvidersStatus, updateProviderConfig, updateProviderApiKey,
} from '../../models/router.js';
import { authMiddleware, requireFeishuAuth, requireRole } from '../middleware.js';
import { getDb } from '../../datamap/db.js';
import { getAllModelPricing } from '../../models/tokenizer.js';
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

/**
 * GET /api/models/usage/accounts?days=30
 * Owner/Admin 专用：每个账户的 token 消耗 + 成本汇总（开发者视角）
 */
router.get('/usage/accounts', authMiddleware, requireRole('admin', 'owner'), (req, res) => {
  const db = getDb();
  const days = Math.min(parseInt(req.query['days'] as string ?? '30', 10), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  type AccountRow = {
    user_id: string; user_name: string | null; role: string | null;
    tokens_in: number; tokens_out: number; cost_usd: number;
    requests: number; active_days: number; last_active: string | null;
  };

  const accounts = db.prepare(`
    SELECT mc.user_id,
           u.name  AS user_name,
           u.role  AS role,
           SUM(mc.tokens_in)   AS tokens_in,
           SUM(mc.tokens_out)  AS tokens_out,
           SUM(mc.cost_usd)    AS cost_usd,
           COUNT(*)            AS requests,
           COUNT(DISTINCT mc.date) AS active_days,
           MAX(mc.date)        AS last_active
    FROM model_costs mc
    LEFT JOIN users u ON u.user_id = mc.user_id
    WHERE mc.date >= ?
    GROUP BY mc.user_id
    ORDER BY cost_usd DESC
  `).all(since) as AccountRow[];

  type TotalsRow = { tokens_in: number; tokens_out: number; cost_usd: number; requests: number; unique_users: number };
  const totals = db.prepare(`
    SELECT SUM(tokens_in) as tokens_in, SUM(tokens_out) as tokens_out,
           SUM(cost_usd) as cost_usd, COUNT(*) as requests, COUNT(DISTINCT user_id) as unique_users
    FROM model_costs WHERE date >= ?
  `).get(since) as TotalsRow;

  res.json({ days, since, accounts, totals });
});

/**
 * GET /api/models/usage/hourly?date=YYYY-MM-DD&user_id=xxx
 * 按小时粒度统计（当天/指定日期）
 * Admin 可看全局或指定用户；普通用户只能看自己
 */
router.get('/usage/hourly', authMiddleware, (req, res) => {
  const db = getDb();
  const isAdmin = ['owner', 'admin'].includes(req.user!.role);
  const date = (req.query['date'] as string) || new Date().toISOString().slice(0, 10);
  const targetUserId = (isAdmin && req.query['user_id'])
    ? (req.query['user_id'] as string)
    : req.user!.user_id;

  type HourRow = { hour: string; tokens_in: number; tokens_out: number; cost_usd: number; requests: number };

  // model_costs 只有 date 字段，小时粒度需从 session_messages 获取
  const byHour = (isAdmin && !req.query['user_id']
    ? db.prepare(`
        SELECT strftime('%H', sm.created_at) AS hour,
               SUM(sm.tokens)   AS tokens_in,
               0                AS tokens_out,
               SUM(sm.cost_usd) AS cost_usd,
               COUNT(*)         AS requests
        FROM session_messages sm
        JOIN sessions s ON s.session_id = sm.session_id
        WHERE sm.role = 'assistant' AND date(sm.created_at) = ?
        GROUP BY hour ORDER BY hour
      `).all(date)
    : db.prepare(`
        SELECT strftime('%H', sm.created_at) AS hour,
               SUM(sm.tokens)   AS tokens_in,
               0                AS tokens_out,
               SUM(sm.cost_usd) AS cost_usd,
               COUNT(*)         AS requests
        FROM session_messages sm
        JOIN sessions s ON s.session_id = sm.session_id
        WHERE sm.role = 'assistant' AND date(sm.created_at) = ? AND s.user_id = ?
        GROUP BY hour ORDER BY hour
      `).all(date, targetUserId)
  ) as HourRow[];

  // 补全 0-23 小时
  const hourMap = new Map(byHour.map(r => [r.hour, r]));
  const full = Array.from({ length: 24 }, (_, i) => {
    const h = String(i).padStart(2, '0');
    return hourMap.get(h) ?? { hour: h, tokens_in: 0, tokens_out: 0, cost_usd: 0, requests: 0 };
  });

  res.json({ date, user_id: targetUserId, hourly: full });
});

/**
 * GET /api/models/pricing-engine?days=30
 * Owner 专属定价引擎：按行为类型分析 token 成本，辅助定价决策
 */
router.get('/pricing-engine', authMiddleware, requireRole('owner'), (req, res) => {
  const db = getDb();
  const days = Math.min(parseInt(req.query['days'] as string ?? '30'), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);

  type BehaviorRow = {
    behavior: string;
    tool_name: string | null;
    model: string;
    calls: number;
    avg_tokens_in: number;
    avg_tokens_out: number;
    avg_cost_usd: number;
    total_cost_usd: number;
  };

  const behaviors = db.prepare(`
    SELECT
      COALESCE(behavior, 'untagged') as behavior,
      tool_name,
      model,
      COUNT(*) as calls,
      AVG(tokens_in) as avg_tokens_in,
      AVG(tokens_out) as avg_tokens_out,
      AVG(cost_usd) as avg_cost_usd,
      SUM(cost_usd) as total_cost_usd
    FROM model_costs
    WHERE date >= ?
    GROUP BY behavior, tool_name, model
    ORDER BY total_cost_usd DESC
  `).all(since) as BehaviorRow[];

  const behaviorsWithCredits = behaviors.map(row => ({
    ...row,
    avg_tokens_in: Math.round(row.avg_tokens_in),
    avg_tokens_out: Math.round(row.avg_tokens_out),
    total_cost_usd: Math.round(row.total_cost_usd * 1_000_000) / 1_000_000,
    avg_cost_usd: Math.round(row.avg_cost_usd * 1_000_000) / 1_000_000,
    // 每 1K 积分（= 1M tokens）的平均成本（USD）
    cost_per_1k_credits: row.avg_tokens_in + row.avg_tokens_out > 0
      ? Math.round((row.avg_cost_usd / ((row.avg_tokens_in + row.avg_tokens_out) / 1_000_000)) * 100) / 100
      : 0,
  }));

  type TotalsRow = { calls: number; tokens_in: number; tokens_out: number; cost_usd: number; unique_users: number };
  const totals = db.prepare(`
    SELECT
      COUNT(*) as calls,
      SUM(tokens_in) as tokens_in,
      SUM(tokens_out) as tokens_out,
      SUM(cost_usd) as cost_usd,
      COUNT(DISTINCT user_id) as unique_users
    FROM model_costs
    WHERE date >= ?
  `).get(since) as TotalsRow;

  const totalTokens = (totals.tokens_in ?? 0) + (totals.tokens_out ?? 0);
  const avgTokensPerCall = totals.calls > 0 ? totalTokens / totals.calls : 0;
  const avgCostPerCredit = avgTokensPerCall > 0
    ? ((totals.cost_usd ?? 0) / totals.calls) / (avgTokensPerCall / 1000)
    : 0;

  res.json({
    period_days: days,
    since,
    behaviors: behaviorsWithCredits,
    model_pricing: getAllModelPricing(),
    credit_analysis: {
      tokens_per_credit: 1000,
      avg_cost_per_credit_usd: Math.round(avgCostPerCredit * 1_000_000) / 1_000_000,
      suggested_price_30pct_margin: Math.round(avgCostPerCredit / 0.7 * 100) / 100,
      suggested_price_50pct_margin: Math.round(avgCostPerCredit / 0.5 * 100) / 100,
    },
    totals: {
      calls: totals.calls ?? 0,
      tokens_in: totals.tokens_in ?? 0,
      tokens_out: totals.tokens_out ?? 0,
      cost_usd: Math.round((totals.cost_usd ?? 0) * 1_000_000) / 1_000_000,
      unique_users: totals.unique_users ?? 0,
    },
  });
});

export default router;
