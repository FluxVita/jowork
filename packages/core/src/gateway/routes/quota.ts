import { Router } from 'express';
import { getQuotaDashboard, getFeishuMonthlyUsage } from '../../quota/manager.js';
import { authMiddleware } from '../middleware.js';

const router = Router();

/** GET /api/quota/dashboard — 配额总览 */
router.get('/dashboard', authMiddleware, (req, res) => {
  const dashboard = getQuotaDashboard();
  res.json(dashboard);
});

/** GET /api/quota/feishu — 飞书配额详情 */
router.get('/feishu', authMiddleware, (req, res) => {
  const usage = getFeishuMonthlyUsage();
  res.json(usage);
});

export default router;
