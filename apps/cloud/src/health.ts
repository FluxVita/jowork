import type { Context } from 'hono';

export function healthCheck(c: Context) {
  return c.json({
    ok: true,
    version: '0.0.1',
    timestamp: new Date().toISOString(),
  });
}
