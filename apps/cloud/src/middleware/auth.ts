import type { Context, Next } from 'hono';
import { verifyJwt } from '../auth/jwt';

/**
 * JWT authentication middleware.
 * Validates Bearer token from Authorization header.
 * Sets userId on context if valid.
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice(7);
  const payload = verifyJwt(token);

  if (!payload) {
    return c.json({ error: 'Invalid or expired token' }, 401);
  }

  c.set('userId', payload.sub);
  c.set('userEmail', payload.email);
  c.set('userPlan', payload.plan);

  await next();
}

/**
 * Optional auth middleware — sets user info if token present, but doesn't block.
 */
export async function optionalAuth(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = verifyJwt(token);
    if (payload) {
      c.set('userId', payload.sub);
      c.set('userEmail', payload.email);
      c.set('userPlan', payload.plan);
    }
  }

  await next();
}
