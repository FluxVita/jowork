import type { Context } from 'hono';

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

  // TODO: verify signature with STRIPE_WEBHOOK_SECRET
  if (!sig && STRIPE_WEBHOOK_SECRET) {
    return c.json({ error: 'Missing signature' }, 400);
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

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.client_reference_id as string;
      const metadata = session.metadata as Record<string, string> | undefined;

      if (metadata?.type === 'credit_top_up') {
        // Add credits to wallet
        const credits = parseInt(metadata.credits || '0', 10);
        console.log(`[Webhook] Top-up: ${credits} credits for user ${userId}`);
        // TODO: update wallet_balance in DB
      } else {
        // Subscription activated
        console.log(`[Webhook] Subscription activated for user ${userId}`);
        // TODO: update user plan in DB
      }
      break;
    }

    case 'customer.subscription.updated': {
      const sub = event.data.object;
      console.log(`[Webhook] Subscription updated: ${sub.id}`);
      // TODO: update plan tier
      break;
    }

    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      console.log(`[Webhook] Subscription cancelled: ${sub.id}`);
      // TODO: downgrade to free
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`[Webhook] Payment failed for invoice: ${invoice.id}`);
      // TODO: notify user, grace period
      break;
    }

    default:
      console.log(`[Webhook] Unhandled event: ${event.type}`);
  }

  return c.json({ received: true });
}
