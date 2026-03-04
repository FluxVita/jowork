// @jowork/core/gateway/middleware — authentication middleware

import type { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../../auth/index.js';
import { config } from '../../config.js';
import { UnauthorizedError, ForbiddenError } from '../../types.js';
import type { Role } from '../../types.js';

// Augment Express Request with auth context
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: Role;
      };
    }
  }
}

/**
 * In personal mode, every request is implicitly authenticated as owner.
 * In team mode, requires a valid Bearer token.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  if (config.personalMode) {
    req.auth = { userId: 'personal', role: 'owner' };
    return next();
  }

  const header = req.headers['authorization'];
  if (!header?.startsWith('Bearer ')) {
    return next(new UnauthorizedError());
  }

  try {
    const payload = verifyToken(header.slice(7));
    req.auth = { userId: payload.sub, role: payload.role };
    next();
  } catch {
    next(new UnauthorizedError());
  }
}

/** Require minimum role. Must be used after authenticate(). */
export function requireRole(minRole: Role) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(new UnauthorizedError());
    const levels: Role[] = ['guest', 'member', 'admin', 'owner'];
    if (levels.indexOf(req.auth.role) < levels.indexOf(minRole)) {
      return next(new ForbiddenError());
    }
    next();
  };
}
