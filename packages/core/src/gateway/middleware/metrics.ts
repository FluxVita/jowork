// @jowork/core/gateway/middleware — automatic request metrics recording
// Tracks method, route pattern, status code, and duration for every HTTP request.

import type { Request, Response, NextFunction } from 'express';
import { recordRequest } from '../../metrics/collector.js';

/** Normalize Express route to a pattern label (collapse IDs, limit cardinality). */
function normalizeRoute(req: Request): string {
  // Use matched Express route pattern if available
  if (req.route?.path) {
    return req.baseUrl + req.route.path;
  }
  // Fallback: collapse UUID/numeric segments to :id
  return req.path.replace(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    ':id',
  ).replace(/\/\d+/g, '/:id');
}

/**
 * Express middleware that records request duration and count into the metrics collector.
 * Mount early (before routes) so it wraps the entire request lifecycle.
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const start = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = Number(process.hrtime.bigint() - start);
    const durationSec = durationNs / 1e9;
    const route = normalizeRoute(req);
    recordRequest(req.method, route, res.statusCode, durationSec);
  });

  next();
}
