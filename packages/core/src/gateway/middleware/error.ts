// @jowork/core/gateway/middleware — error handler

import type { Request, Response, NextFunction } from 'express';
import { JoworkError } from '../../types.js';
import { logger } from '../../utils/index.js';

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof JoworkError) {
    res.status(err.statusCode).json({ error: err.code, message: err.message });
    return;
  }

  logger.error('Unhandled error', { err: String(err) });
  res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Internal server error' });
}
