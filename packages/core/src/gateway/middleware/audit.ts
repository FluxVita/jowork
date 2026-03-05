// @jowork/core/gateway/middleware — audit logging middleware
//
// Automatically logs all non-GET/HEAD/OPTIONS requests (mutations) to the audit_log table.
// Captures user ID from req headers (set by authenticate middleware), HTTP method,
// path, response status code, IP, and user-agent.

import type { Request, Response, NextFunction } from 'express';
import { recordAudit, inferResourceType } from '../../audit/index.js';

/** Methods that are read-only and should not be audited. */
const SKIP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Paths that should never be audited (noisy or internal). */
const SKIP_PATHS = ['/health', '/metrics', '/api/admin/updates/check'];

export function auditMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (SKIP_METHODS.has(req.method)) {
    next();
    return;
  }

  const path = req.originalUrl.split('?')[0] ?? req.originalUrl;
  if (SKIP_PATHS.some(p => path.startsWith(p))) {
    next();
    return;
  }

  // Record audit after response is sent (so we have status code)
  res.on('finish', () => {
    const userId = (req as unknown as Record<string, unknown>)['userId'] as string | undefined;
    if (!userId) return; // unauthenticated request, skip

    try {
      recordAudit({
        userId,
        action: req.method,
        resource: path,
        resourceType: inferResourceType(path),
        statusCode: res.statusCode,
        ip: req.ip ?? req.socket.remoteAddress ?? '',
        userAgent: req.get('user-agent') ?? '',
      });
    } catch {
      // Never let audit logging break the request flow
    }
  });

  next();
}
