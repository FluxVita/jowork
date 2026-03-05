import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware.js';
import { getCreditsBalance } from '../../billing/credits.js';
import {
  getSubscriptionPlan,
  PERSONAL_MONTHLY_CREDITS,
  PLAN_UPGRADE_TARGET,
  type PersonalPlan,
} from '../../billing/entitlements.js';
import { getUserPlan } from '../../billing/features.js';
import {
  isStripeEnabled,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleSubscriptionDeleted,
} from '../../billing/stripe.js';
import { getDb } from '../../datamap/db.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';
import type Stripe from 'stripe';

const log = createLogger('billing-routes');
const router = Router();

// ─── 用户端 ───

/** GET /api/billing/credits — 当前用户积分余量 */
router.get('/credits', authMiddleware, (req: Request, res: Response) => {
  try {
    const balance = getCreditsBalance(req.user!.user_id);
    res.json({
      ...balance,
      billing_month: new Date().toISOString().slice(0, 7),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/billing/plan — 当前计划（per-user，含 Stripe 订阅信息） */
router.get('/plan', authMiddleware, (req: Request, res: Response) => {
  try {
    const userId = req.user!.user_id;
    const plan = getUserPlan(userId);
    const monthly_credits = plan in PERSONAL_MONTHLY_CREDITS
      ? PERSONAL_MONTHLY_CREDITS[plan as PersonalPlan]
      : null;

    // 从 user_subscriptions 取 Stripe 相关信息
    const db = getDb();
    const sub = db.prepare(`
      SELECT stripe_subscription_id, status, current_period_end, cancel_at_period_end, seat_level
      FROM user_subscriptions WHERE user_id = ?
    `).get(userId) as {
      stripe_subscription_id: string | null;
      status: string;
      current_period_end: string | null;
      cancel_at_period_end: number;
      seat_level: string;
    } | undefined;

    res.json({
      plan,
      monthly_credits,
      upgrade_to: PLAN_UPGRADE_TARGET[plan] ?? null,
      stripe_enabled: isStripeEnabled(),
      subscription: sub ? {
        status: sub.status,
        current_period_end: sub.current_period_end,
        cancel_at_period_end: !!sub.cancel_at_period_end,
        seat_level: sub.seat_level,
      } : null,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/billing/credits/history?days=30 — 积分消耗历史 */
router.get('/credits/history', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  const days = Math.min(parseInt((req.query['days'] as string) ?? '30'), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 7);

  try {
    const rows = db.prepare(`
      SELECT billing_month, SUM(credits) as credits_used, COUNT(*) as calls
      FROM credit_transactions
      WHERE user_id = ? AND billing_month >= ? AND source = 'model_call'
      GROUP BY billing_month
      ORDER BY billing_month DESC
    `).all(req.user!.user_id, since);

    res.json({ days, rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/billing/prices — 价格列表（含 stripe_price_id） */
router.get('/prices', authMiddleware, (req: Request, res: Response) => {
  const db = getDb();
  try {
    const rows = db.prepare(`
      SELECT id, plan, seat_level, billing_cycle, stripe_price_id, amount_cents, currency
      FROM billing_prices WHERE active = 1
      ORDER BY plan, seat_level, billing_cycle
    `).all();
    res.json({ stripe_enabled: isStripeEnabled(), prices: rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/billing/checkout — 创建 Stripe Checkout Session */
router.post('/checkout', authMiddleware, async (req: Request, res: Response) => {
  if (!isStripeEnabled()) {
    res.status(503).json({ error: 'Stripe not configured on this instance' });
    return;
  }

  const { price_id } = req.body as { price_id: string };
  if (!price_id) {
    res.status(400).json({ error: 'price_id required' });
    return;
  }

  // 查 stripe_price_id
  const db = getDb();
  const priceRow = db.prepare('SELECT stripe_price_id FROM billing_prices WHERE id = ? AND active = 1').get(price_id) as { stripe_price_id: string | null } | undefined;

  const stripePriceId = priceRow?.stripe_price_id;
  if (!stripePriceId) {
    res.status(400).json({ error: 'Stripe price ID not configured for this plan. Please set it in Admin → Billing.' });
    return;
  }

  const baseUrl = config.gateway_public_url ?? `http://localhost:${config.port}`;

  try {
    const { url, session_id } = await createCheckoutSession({
      userId: req.user!.user_id,
      email: req.user!.email,
      name: req.user!.name,
      stripePriceId,
      successUrl: `${baseUrl}/shell.html?billing=success`,
      cancelUrl: `${baseUrl}/shell.html?billing=cancel`,
    });
    res.json({ url, session_id });
  } catch (err) {
    log.error('Checkout session creation failed', err);
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/billing/portal — 创建 Stripe Customer Portal */
router.post('/portal', authMiddleware, async (req: Request, res: Response) => {
  if (!isStripeEnabled()) {
    res.status(503).json({ error: 'Stripe not configured' });
    return;
  }

  const baseUrl = config.gateway_public_url ?? `http://localhost:${config.port}`;
  try {
    const url = await createPortalSession(req.user!.user_id, `${baseUrl}/shell.html`);
    res.json({ url });
  } catch (err) {
    log.error('Portal session creation failed', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Stripe Webhook（无 authMiddleware，用原始 body 验证签名） ───
// 注意：此路由依赖 server.ts 中在 json 中间件之前注册的 rawBody 中间件

router.post('/webhook', async (req: Request, res: Response) => {
  const sig = req.headers['stripe-signature'];
  if (!sig || typeof sig !== 'string') {
    res.status(400).json({ error: 'Missing stripe-signature header' });
    return;
  }

  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  if (!rawBody) {
    res.status(400).json({ error: 'Raw body not available' });
    return;
  }

  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(rawBody, sig);
  } catch (err) {
    log.warn('Webhook signature verification failed', err);
    res.status(400).json({ error: `Webhook Error: ${String(err)}` });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'customer.subscription.updated':
        handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;
      case 'customer.subscription.deleted':
        handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;
      default:
        // 其他事件暂时忽略
        break;
    }
    res.json({ received: true });
  } catch (err) {
    log.error('Webhook handler error', err);
    res.status(500).json({ error: String(err) });
  }
});

// ─── Admin 接口 ───

/** GET /api/billing/admin/subscriptions?page=1&limit=50 — 所有用户订阅列表 */
router.get('/admin/subscriptions', authMiddleware, (req: Request, res: Response) => {
  if (req.user!.role !== 'owner' && req.user!.role !== 'admin') {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }

  const db = getDb();
  const page = Math.max(parseInt((req.query['page'] as string) ?? '1'), 1);
  const limit = Math.min(parseInt((req.query['limit'] as string) ?? '50'), 200);
  const offset = (page - 1) * limit;

  try {
    const rows = db.prepare(`
      SELECT us.user_id, u.name, u.email, u.role,
             us.plan, us.seat_level, us.status,
             us.current_period_end, us.cancel_at_period_end,
             us.stripe_customer_id, us.stripe_subscription_id
      FROM user_subscriptions us
      JOIN users u ON u.user_id = us.user_id
      ORDER BY us.updated_at DESC
      LIMIT ? OFFSET ?
    `).all(limit, offset);

    const total = (db.prepare('SELECT COUNT(*) as n FROM user_subscriptions').get() as { n: number }).n;
    res.json({ total, page, limit, rows });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** PUT /api/billing/admin/user/:userId/plan — Owner 强制覆盖用户计划 */
router.put('/admin/user/:userId/plan', authMiddleware, (req: Request, res: Response) => {
  if (req.user!.role !== 'owner') {
    res.status(403).json({ error: 'Owner only' });
    return;
  }

  const { plan, seat_level } = req.body as { plan: string; seat_level?: string };
  const userId = req.params['userId'] as string;
  if (!plan) {
    res.status(400).json({ error: 'plan required' });
    return;
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO user_subscriptions (user_id, plan, seat_level, status, updated_at)
    VALUES (?, ?, ?, 'active', datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, seat_level = excluded.seat_level, updated_at = datetime('now')
  `).run(userId, plan, seat_level ?? 'basic');

  res.json({ ok: true, userId, plan, seat_level: seat_level ?? 'basic' });
});

/** GET /api/billing/admin/prices — 管理价格配置 */
router.get('/admin/prices', authMiddleware, (req: Request, res: Response) => {
  if (req.user!.role !== 'owner') {
    res.status(403).json({ error: 'Owner only' });
    return;
  }

  const db = getDb();
  const rows = db.prepare('SELECT * FROM billing_prices ORDER BY plan, seat_level, billing_cycle').all();
  res.json(rows);
});

/** PUT /api/billing/admin/prices/:id — 更新价格（Stripe Price ID + 金额） */
router.put('/admin/prices/:id', authMiddleware, (req: Request, res: Response) => {
  if (req.user!.role !== 'owner') {
    res.status(403).json({ error: 'Owner only' });
    return;
  }

  const { stripe_price_id, amount_cents, active } = req.body as {
    stripe_price_id?: string;
    amount_cents?: number;
    active?: boolean;
  };
  const id = req.params['id'] as string;

  const db = getDb();
  db.prepare(`
    UPDATE billing_prices
    SET stripe_price_id = COALESCE(?, stripe_price_id),
        amount_cents = COALESCE(?, amount_cents),
        active = COALESCE(?, active),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(stripe_price_id ?? null, amount_cents ?? null, active !== undefined ? (active ? 1 : 0) : null, id);

  res.json({ ok: true });
});

export default router;
