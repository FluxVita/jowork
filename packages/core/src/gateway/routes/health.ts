// @jowork/core/gateway/routes — health check

import { Router } from 'express';

export function healthRouter(): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', ts: new Date().toISOString() });
  });

  return router;
}
