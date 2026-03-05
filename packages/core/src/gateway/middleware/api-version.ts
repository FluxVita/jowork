// @jowork/core/gateway/middleware — API versioning
//
// Supports both /api/* (legacy, deprecated) and /api/v1/* (preferred).
// /api/v1/* requests are rewritten to /api/* so existing route handlers match.
// /api/* requests get a Deprecation header pointing to /api/v1.

import type { Request, Response, NextFunction } from 'express';

const V1_PREFIX = '/api/v1/';
const API_PREFIX = '/api/';

export function apiVersionMiddleware(req: Request, res: Response, next: NextFunction): void {
  if (req.url.startsWith(V1_PREFIX)) {
    // Rewrite /api/v1/xxx to /api/xxx for route matching
    req.url = API_PREFIX + req.url.slice(V1_PREFIX.length);
    // Also fix originalUrl for logging/audit
    if (req.originalUrl.startsWith(V1_PREFIX)) {
      (req as unknown as { originalUrl: string }).originalUrl = API_PREFIX + req.originalUrl.slice(V1_PREFIX.length);
    }
    next();
    return;
  }

  if (req.url.startsWith(API_PREFIX) && !req.url.startsWith('/api/v1')) {
    // Legacy /api/* path — add deprecation header
    res.setHeader('Deprecation', 'true');
    res.setHeader('Sunset', '2027-01-01');
    res.setHeader('Link', `</api/v1${req.url.slice(4)}>; rel="successor-version"`);
  }

  next();
}
