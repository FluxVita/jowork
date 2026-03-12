import type { Context } from 'hono';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

/**
 * POST /billing/checkout — create Stripe Checkout session for subscription
 */
export async function createCheckout(c: Context): Promise<Response> {
  const userId = c.get('userId');
  const { planId, successUrl, cancelUrl } = await c.req.json();

  if (!STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'subscription',
        'line_items[0][price]': planId,
        'line_items[0][quantity]': '1',
        success_url: successUrl || 'jowork://billing/success',
        cancel_url: cancelUrl || 'jowork://billing/cancel',
        client_reference_id: userId,
      }),
    });

    const session = await res.json();
    return c.json({ url: (session as { url: string }).url });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
}

/**
 * GET /billing/portal — create Stripe Customer Portal session
 */
export async function createPortal(c: Context): Promise<Response> {
  const _userId = c.get('userId');

  if (!STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  // TODO: look up stripe_customer_id from users table
  return c.json({ error: 'Not implemented — need stripe_customer_id' }, 501);
}

/**
 * POST /billing/top-up — create Stripe Checkout for one-time credit purchase
 */
export async function createTopUp(c: Context): Promise<Response> {
  const userId = c.get('userId');
  const { amount, successUrl, cancelUrl } = await c.req.json();

  if (!STRIPE_SECRET_KEY) {
    return c.json({ error: 'Stripe not configured' }, 503);
  }

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        mode: 'payment',
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][product_data][name]': `JoWork Credits (${amount})`,
        'line_items[0][price_data][unit_amount]': String(amount),
        'line_items[0][quantity]': '1',
        success_url: successUrl || 'jowork://billing/success',
        cancel_url: cancelUrl || 'jowork://billing/cancel',
        client_reference_id: userId,
        'metadata[type]': 'credit_top_up',
        'metadata[credits]': String(amount),
      }),
    });

    const session = await res.json();
    return c.json({ url: (session as { url: string }).url });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
}
