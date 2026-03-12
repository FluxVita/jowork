import type { Context, Next } from 'hono';

/**
 * JWT authentication middleware — placeholder for Phase 6.
 * Currently passes through all requests with a mock user.
 */
export async function authMiddleware(c: Context, next: Next) {
  // Phase 6: validate JWT from Authorization header
  // For now, set a placeholder user context
  c.set('userId', 'anonymous');
  await next();
}
