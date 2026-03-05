import Stripe from 'stripe';
import { config } from '../config.js';
import { getDb } from '../datamap/db.js';
import { normalizePlanPublic, type SubscriptionPlan } from './entitlements.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('stripe');

// ─── Stripe 客户端（懒初始化，无 key 时返回 null） ───

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_stripe) return _stripe;
  const key = config.stripe?.secret_key;
  if (!key) return null;
  _stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  return _stripe;
}

export function isStripeEnabled(): boolean {
  return !!config.stripe?.secret_key;
}

// ─── 辅助：获取或创建 Stripe Customer ───

export async function getOrCreateCustomer(userId: string, email?: string, name?: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const db = getDb();
  const row = db.prepare('SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = ?').get(userId) as { stripe_customer_id: string | null } | undefined;

  if (row?.stripe_customer_id) return row.stripe_customer_id;

  // 创建新 Customer
  const customer = await stripe.customers.create({
    email,
    name,
    metadata: { user_id: userId },
  });

  // 写入 DB
  db.prepare(`
    INSERT INTO user_subscriptions (user_id, stripe_customer_id, plan, status)
    VALUES (?, ?, 'free', 'active')
    ON CONFLICT(user_id) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id, updated_at = datetime('now')
  `).run(userId, customer.id);

  log.info('Stripe customer created', { userId, customerId: customer.id });
  return customer.id;
}

// ─── 创建 Checkout Session ───

export async function createCheckoutSession(opts: {
  userId: string;
  email?: string;
  name?: string;
  stripePriceId: string;
  successUrl: string;
  cancelUrl: string;
  mode?: 'subscription' | 'payment';
}): Promise<{ url: string; session_id: string }> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const customerId = await getOrCreateCustomer(opts.userId, opts.email, opts.name);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: opts.mode ?? 'subscription',
    line_items: [{ price: opts.stripePriceId, quantity: 1 }],
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl,
    metadata: { user_id: opts.userId },
    subscription_data: {
      metadata: { user_id: opts.userId },
    },
    allow_promotion_codes: true,
    billing_address_collection: 'auto',
  });

  if (!session.url) throw new Error('Stripe session URL missing');
  return { url: session.url, session_id: session.id };
}

// ─── 创建 Customer Portal（管理订阅 / 取消 / 改计划） ───

export async function createPortalSession(userId: string, returnUrl: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const db = getDb();
  const row = db.prepare('SELECT stripe_customer_id FROM user_subscriptions WHERE user_id = ?').get(userId) as { stripe_customer_id: string | null } | undefined;

  if (!row?.stripe_customer_id) throw new Error('No Stripe customer found for user');

  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripe_customer_id,
    return_url: returnUrl,
  });

  return session.url;
}

// ─── Webhook 事件处理 ───

export function constructWebhookEvent(rawBody: Buffer, signature: string): Stripe.Event {
  const stripe = getStripe();
  if (!stripe) throw new Error('Stripe not configured');

  const webhookSecret = config.stripe?.webhook_secret;
  if (!webhookSecret) throw new Error('STRIPE_WEBHOOK_SECRET not set');

  return stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

/** 处理 checkout.session.completed → 激活订阅 */
export function handleCheckoutCompleted(session: Stripe.Checkout.Session): void {
  const userId = session.metadata?.['user_id'];
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
  const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.id;

  if (!userId) {
    log.warn('Webhook: checkout.session.completed missing user_id metadata', { sessionId: session.id });
    return;
  }

  const db = getDb();
  db.prepare(`
    INSERT INTO user_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan, status, updated_at)
    VALUES (?, ?, ?, 'personal_basic', 'active', datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      stripe_customer_id = excluded.stripe_customer_id,
      stripe_subscription_id = excluded.stripe_subscription_id,
      status = 'active',
      updated_at = datetime('now')
  `).run(userId, customerId ?? null, subscriptionId ?? null);

  log.info('Subscription activated via checkout', { userId, subscriptionId });
}

/** 处理 customer.subscription.updated → 同步计划状态 */
export function handleSubscriptionUpdated(subscription: Stripe.Subscription): void {
  const userId = subscription.metadata?.['user_id'];
  if (!userId) return;

  // 从 price metadata 或 billing_prices 表反查 plan
  const priceId = subscription.items.data[0]?.price?.id ?? '';
  const db = getDb();
  const priceRow = db.prepare('SELECT plan, seat_level FROM billing_prices WHERE stripe_price_id = ?').get(priceId) as { plan: string; seat_level: string | null } | undefined;

  const plan: SubscriptionPlan = priceRow ? normalizePlanPublic(priceRow.plan) : 'personal_basic';
  const seatLevel = priceRow?.seat_level ?? 'basic';
  const status = subscription.status === 'active' || subscription.status === 'trialing' ? 'active' : subscription.status;
  const periodStart = new Date(subscription.current_period_start * 1000).toISOString();
  const periodEnd = new Date(subscription.current_period_end * 1000).toISOString();
  const cancelAtPeriodEnd = subscription.cancel_at_period_end ? 1 : 0;

  db.prepare(`
    INSERT INTO user_subscriptions (user_id, stripe_subscription_id, plan, seat_level, status, current_period_start, current_period_end, cancel_at_period_end, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET
      stripe_subscription_id = excluded.stripe_subscription_id,
      plan = excluded.plan,
      seat_level = excluded.seat_level,
      status = excluded.status,
      current_period_start = excluded.current_period_start,
      current_period_end = excluded.current_period_end,
      cancel_at_period_end = excluded.cancel_at_period_end,
      updated_at = datetime('now')
  `).run(userId, subscription.id, plan, seatLevel, status, periodStart, periodEnd, cancelAtPeriodEnd);

  log.info('Subscription updated', { userId, plan, status });
}

/** 处理 customer.subscription.deleted → 降级为 free */
export function handleSubscriptionDeleted(subscription: Stripe.Subscription): void {
  const userId = subscription.metadata?.['user_id'];
  if (!userId) return;

  const db = getDb();
  db.prepare(`
    UPDATE user_subscriptions
    SET plan = 'free', status = 'canceled', stripe_subscription_id = NULL, updated_at = datetime('now')
    WHERE user_id = ?
  `).run(userId);

  log.info('Subscription canceled → downgraded to free', { userId });
}
