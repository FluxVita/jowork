// @jowork/core/gateway/routes — LLM cost dashboard API
//
// GET  /api/usage/summary          — monthly usage summary (by model/provider/type)
// GET  /api/usage/daily            — daily spend chart data for the current month
// GET  /api/usage/budget           — current budget status + alert level
// PUT  /api/usage/budget           — configure budget (limit + thresholds)
// GET  /api/usage/recommend        — model recommendation based on input length
// GET  /api/usage/team             — aggregate team spend (owner/admin only)

import { Router } from 'express';
import { getDb } from '../../datamap/db.js';
import {
  queryUsageSummary,
  queryDailySpend,
  checkBudgetStatus,
  upsertBudgetConfig,
  getBudgetConfig,
  recommendModel,
} from '../../datamap/usage.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import type { Request } from 'express';

interface AuthRequest extends Request {
  userId?: string;
}

export function usageRouter(): Router {
  const router = Router();

  // GET /api/usage/summary?year=2026&month=3
  // Monthly usage summary for the authenticated user.
  router.get('/api/usage/summary', authenticate, (req: AuthRequest, res, next) => {
    try {
      const now = new Date();
      const year  = parseInt(String(req.query['year']  ?? now.getFullYear()),  10);
      const month = parseInt(String(req.query['month'] ?? now.getMonth() + 1), 10);
      const userId = req.userId;
      // exactOptionalPropertyTypes: only pass userId when it's a string
      const opts = userId !== undefined
        ? { userId, year, month }
        : { year, month };
      const rows = queryUsageSummary(getDb(), opts);
      const totalCostUsd = rows.reduce((s, r) => s + r.totalCostUsd, 0);
      res.json({ year, month, userId: userId ?? 'all', summary: rows, totalCostUsd });
    } catch (err) { next(err); }
  });

  // GET /api/usage/daily?year=2026&month=3
  // Daily spend for the current month (for sparkline charts).
  router.get('/api/usage/daily', authenticate, (req: AuthRequest, res, next) => {
    try {
      const now = new Date();
      const year  = parseInt(String(req.query['year']  ?? now.getFullYear()),  10);
      const month = parseInt(String(req.query['month'] ?? now.getMonth() + 1), 10);
      const userId = req.userId ?? 'system';
      const rows = queryDailySpend(getDb(), userId, year, month);
      res.json({ userId, year, month, daily: rows });
    } catch (err) { next(err); }
  });

  // GET /api/usage/budget — current budget status for this user
  router.get('/api/usage/budget', authenticate, (req: AuthRequest, res, next) => {
    try {
      const userId = req.userId ?? 'system';
      const status = checkBudgetStatus(getDb(), userId);
      const config = getBudgetConfig(getDb(), userId) ?? getBudgetConfig(getDb(), 'global');
      if (!status) {
        res.json({ configured: false, config });
        return;
      }
      res.json({ configured: true, ...status, config });
    } catch (err) { next(err); }
  });

  // PUT /api/usage/budget — set / update budget
  // Body: { monthlyLimitUsd, warnPct?, alertPct?, blockPct?, userId? }
  router.put('/api/usage/budget', authenticate, (req: AuthRequest, res, next) => {
    try {
      const body = req.body as {
        monthlyLimitUsd?: number;
        warnPct?: number;
        alertPct?: number;
        blockPct?: number;
        userId?: string;
      };

      if (typeof body.monthlyLimitUsd !== 'number' || body.monthlyLimitUsd < 0) {
        res.status(400).json({ error: 'monthlyLimitUsd must be a non-negative number' });
        return;
      }

      // Default to the authenticated user's budget; admins may pass a different userId
      const targetUserId = body.userId ?? (req.userId ?? 'system');

      upsertBudgetConfig(getDb(), {
        userId: targetUserId,
        monthlyLimitUsd: body.monthlyLimitUsd,
        warnPct:  body.warnPct  ?? 0.8,
        alertPct: body.alertPct ?? 1.0,
        blockPct: body.blockPct ?? 1.2,
      });

      res.json({ ok: true, userId: targetUserId });
    } catch (err) { next(err); }
  });

  // GET /api/usage/recommend?text=<sample input text>&provider=anthropic
  // Returns a model recommendation based on input complexity.
  router.get('/api/usage/recommend', authenticate, (req: AuthRequest, res, next) => {
    try {
      const text = String(req.query['text'] ?? '');
      const provider = String(req.query['provider'] ?? process.env['MODEL_PROVIDER'] ?? 'anthropic');
      const rec = recommendModel(text, provider);
      res.json(rec);
    } catch (err) { next(err); }
  });

  // GET /api/usage/team?year=2026&month=3
  // Team-level aggregated spend by user (admin/owner only).
  router.get('/api/usage/team', authenticate, requireRole('admin'), (req: AuthRequest, res, next) => {
    try {
      const now = new Date();
      const year  = parseInt(String(req.query['year']  ?? now.getFullYear()),  10);
      const month = parseInt(String(req.query['month'] ?? now.getMonth() + 1), 10);
      const rows = queryUsageSummary(getDb(), { year, month });
      // Aggregate by userId across all models
      const byUser = new Map<string, {
        totalCostUsd: number;
        totalInputTokens: number;
        totalOutputTokens: number;
        callCount: number;
      }>();
      for (const r of rows) {
        const prev = byUser.get(r.userId) ?? { totalCostUsd: 0, totalInputTokens: 0, totalOutputTokens: 0, callCount: 0 };
        byUser.set(r.userId, {
          totalCostUsd: prev.totalCostUsd + r.totalCostUsd,
          totalInputTokens: prev.totalInputTokens + r.totalInputTokens,
          totalOutputTokens: prev.totalOutputTokens + r.totalOutputTokens,
          callCount: prev.callCount + r.callCount,
        });
      }
      const teamSummary = Array.from(byUser.entries())
        .map(([userId, stats]) => ({ userId, ...stats }))
        .sort((a, b) => b.totalCostUsd - a.totalCostUsd);
      const totalCostUsd = teamSummary.reduce((s, r) => s + r.totalCostUsd, 0);
      res.json({ year, month, teamSummary, totalCostUsd });
    } catch (err) { next(err); }
  });

  return router;
}
