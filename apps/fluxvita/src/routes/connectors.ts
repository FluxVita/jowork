// apps/fluxvita — connector management routes (same as jowork, uses @jowork/core)

import { Router } from 'express';
import {
  authenticate, requireRole,
  createConnectorConfig, listConnectorConfigs, getConnectorConfig, deleteConnectorConfig,
  listRegisteredConnectors, getConnector,
} from '@jowork/core';
import type { ConnectorKind } from '@jowork/core';

export function connectorsRouter(): Router {
  const router = Router();

  router.get('/api/connector-types', authenticate, (_req, res) => {
    res.json(listRegisteredConnectors());
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
      const cfg = getConnectorConfig(String(req.params['id']));
      const connector = getConnector(cfg.kind);
      const results = await connector.discover(cfg);
      res.json(results);
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
