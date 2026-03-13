import type { Context } from 'hono';
import { eq, and, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { users, credits } from '../db/schema';

const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

/**
 * POST /billing/webhook — handle Stripe webhook events
 */
export async function handleWebhook(c: Context): Promise<Response> {
  const body = await c.req.text();
  const sig = c.req.header('stripe-signature');

  // Verify Stripe webhook signature — required in production
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error('[Webhook] STRIPE_WEBHOOK_SECRET not configured — rejecting request');
    return c.json({ error: 'Webhook not configured' }, 503);
  }

  if (!sig) {
    return c.json({ error: 'Missing signature' }, 400);
  }

  const crypto = await import('crypto');
  const elements = sig.split(',');
  const timestamp = elements.find((e) => e.startsWith('t='))?.slice(2);
  const v1Sig = elements.find((e) => e.startsWith('v1='))?.slice(3);

  if (!timestamp || !v1Sig) {
    return c.json({ error: 'Malformed signature' }, 400);
  }

  // Reject events older than 5 minutes (replay protection)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10);
  if (Number.isNaN(age) || age > 300) {
    return c.json({ error: 'Stale signature' }, 400);
  }

  const expected = crypto
    .createHmac('sha256', STRIPE_WEBHOOK_SECRET)
    .update(`${timestamp}.${body}`)
    .digest('hex');

  if (expected !== v1Sig) {
    return c.json({ error: 'Invalid signature' }, 400);
  }

  let event: StripeEvent;
  try {
    event = JSON.parse(body);
    if (!event.type || !event.data?.object) {
      return c.json({ error: 'Invalid event structure' }, 400);
    }
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  try {
    const db = getDb();

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id as string;
        const metadata = session.metadata as Record<string, string> | undefined;
        const customerId = session.customer as string | undefined;

        if (!userId) break;

        // Store stripe customer ID on user
        if (customerId) {
          await db.update(users)
            .set({ stripeCustomerId: customerId, updatedAt: new Date() })
            .where(eq(users.id, userId));
        }

        if (metadata?.type === 'credit_top_up') {
          // Add credits to wallet
          const creditAmount = parseInt(metadata.credits || '0', 10);
          await db.update(credits)
            .set({ walletBalance: sql`${credits.walletBalance} + ${creditAmount}` })
            .where(and(eq(credits.userId, userId), isNull(credits.teamId)));

          console.log(`[Webhook] Top-up: ${creditAmount} credits for user ${userId}`);
        } else {
          // Subscription activated — upgrade user plan
          const planId = metadata?.planId ?? 'pro';
          await db.update(users)
            .set({ plan: planId, updatedAt: new Date() })
            .where(eq(users.id, userId));

          // Update monthly credit limit based on plan
          const { PLANS } = await import('./plans');
          const planConfig = PLANS[planId];
          if (planConfig) {
            await db.update(credits)
              .set({
                monthlyLimit: planConfig.monthlyCredits,
                dailyFreeLimit: planConfig.dailyFreeCredits,
                used: 0,
              })
              .where(and(eq(credits.userId, userId), isNull(credits.teamId)));
          }

          console.log(`[Webhook] Subscription activated: ${planId} for user ${userId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object;
        const customerId = sub.customer as string;
        const status = sub.status as string;
        const priceId = ((sub.items as { data?: Array<{ price?: { id: string } }> })
          ?.data?.[0]?.price?.id) as string | undefined;

        if (status === 'active' && customerId) {
          // Find user by stripe customer ID and update plan
          const [user] = await db.select().from(users)
            .where(eq(users.stripeCustomerId, customerId));

          if (user) {
            const { PLANS } = await import('./plans');
            const plan = Object.values(PLANS).find((p) => p.stripePriceId === priceId);
            if (plan) {
              await db.update(users)
                .set({ plan: plan.id, updatedAt: new Date() })
                .where(eq(users.id, user.id));
            }
          }
        }
        console.log(`[Webhook] Subscription updated: ${sub.id}`);
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const customerId = sub.customer as string;

        // Downgrade to free
        if (customerId) {
          const [user] = await db.select().from(users)
            .where(eq(users.stripeCustomerId, customerId));

          if (user) {
            await db.update(users)
              .set({ plan: 'free', updatedAt: new Date() })
              .where(eq(users.id, user.id));

            // Reset credit limits to free tier
            const { PLANS } = await import('./plans');
            const freePlan = PLANS.free;
            await db.update(credits)
              .set({
                monthlyLimit: freePlan.monthlyCredits,
                dailyFreeLimit: freePlan.dailyFreeCredits,
                used: 0,
              })
              .where(and(eq(credits.userId, user.id), isNull(credits.teamId)));
          }
        }
        console.log(`[Webhook] Subscription cancelled: ${sub.id}`);
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const customerId = invoice.customer as string;

        // Mark user for payment follow-up (don't downgrade yet — grace period)
        if (customerId) {
          const [user] = await db.select().from(users)
            .where(eq(users.stripeCustomerId, customerId));

          if (user) {
            console.log(`[Webhook] Payment failed for user ${user.id}, invoice ${invoice.id}`);
            // Grace period: user keeps plan for now
            // A scheduled task can check and downgrade after N days
          }
        }
        break;
      }

      default:
        console.log(`[Webhook] Unhandled event: ${event.type}`);
    }
  } catch (err) {
    // Log but don't fail the webhook (Stripe will retry)
    console.error(`[Webhook] Processing error: ${err}`);
  }

  return c.json({ received: true });
}
