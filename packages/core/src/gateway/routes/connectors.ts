// @jowork/core/gateway/routes/connectors — Connector management REST API
//
// Routes:
//   GET    /api/connector-types          — list all available connector types
//   GET    /api/connectors               — list user's connector instances
//   POST   /api/connectors               — create a new connector instance (admin+)
//   POST   /api/connectors/:id/discover  — discover objects via connector
//   DELETE /api/connectors/:id           — delete connector instance (admin+)

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  createConnectorConfig, listConnectorConfigs, getConnectorConfig, deleteConnectorConfig,
  listAllConnectorTypes, discoverViaConnector,
} from '../../connectors/index.js';
import type { ConnectorKind } from '../../types.js';

export function connectorsRouter(): Router {
  const router = Router();

  router.get('/api/connector-types', authenticate, (_req, res) => {
    res.json(listAllConnectorTypes());
  });

  router.get('/api/connectors', authenticate, (req, res, next) => {
    try {
      res.json(listConnectorConfigs(req.auth!.userId));
    } catch (err) { next(err); }
  });

  router.post('/api/connectors', authenticate, requireRole('admin'), (req, res, next) => {
    try {
      const { kind, name, settings } = req.body as { kind: ConnectorKind; name: string; settings: Record<string, unknown> };
      const cfg = createConnectorConfig({ kind, name, settings, ownerId: req.auth!.userId });
      res.status(201).json(cfg);
    } catch (err) { next(err); }
  });

  router.post('/api/connectors/:id/discover', authenticate, async (req, res, next) => {
    try {
      const cfg    = getConnectorConfig(String(req.params['id']));
      const cursor = req.query['cursor'] as string | undefined;
      const result = await discoverViaConnector(cfg, cursor);
      res.json(result);
    } catch (err) { next(err); }
  });

  router.delete('/api/connectors/:id', authenticate, requireRole('admin'), (req, res, next) => {
    try {
      deleteConnectorConfig(String(req.params['id']));
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
