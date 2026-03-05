// @jowork/core/gateway/routes — Prometheus metrics endpoint
// GET /metrics → Prometheus text exposition format

import { Router } from 'express';
import { renderPrometheus } from '../../metrics/collector.js';

export function metricsRouter(): Router {
  const router = Router();

  router.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(renderPrometheus());
  });

  return router;
}
