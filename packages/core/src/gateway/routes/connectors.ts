// @jowork/core/gateway/routes/connectors — Connector management REST API
//
// Routes:
//   GET    /api/connector-types          — list all available connector types (with manifest info)
//   GET    /api/connector-types/:id      — full manifest for a specific JCP connector type
//   GET    /api/connectors               — list user's connector instances
//   POST   /api/connectors               — create a new connector instance (admin+)
//   POST   /api/connectors/:id/discover  — discover objects via connector
//   POST   /api/connectors/:id/fetch     — fetch specific object content by ID
//   POST   /api/connectors/:id/search    — full-text search within connector
//   DELETE /api/connectors/:id           — delete connector instance (admin+)

import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import {
  createConnectorConfig, listConnectorConfigs, getConnectorConfig, deleteConnectorConfig,
  listAllConnectorTypes, getConnectorTypeManifest, discoverViaConnector, connectorFetch, connectorSearch,
  getConnectorHealth,
} from '../../connectors/index.js';
import type { ConnectorKind } from '../../types.js';

export function connectorsRouter(): Router {
  const router = Router();

  router.get('/api/connector-types', authenticate, (_req, res) => {
    res.json(listAllConnectorTypes());
  });

  router.get('/api/connector-types/:id', authenticate, (req, res) => {
    const manifest = getConnectorTypeManifest(String(req.params['id']));
    if (!manifest) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
    res.json(manifest);
  });

  router.get('/api/connectors', authenticate, (req, res, next) => {
    try {
      const configs = listConnectorConfigs(req.auth!.userId);
      // Attach runtime health status to each connector
      const withHealth = configs.map(cfg => ({
        ...cfg,
        health: getConnectorHealth(cfg.kind as ConnectorKind),
      }));
      res.json(withHealth);
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

  router.post('/api/connectors/:id/fetch', authenticate, async (req, res, next) => {
    try {
      const cfg = getConnectorConfig(String(req.params['id']));
      const { objectId } = req.body as { objectId: string };
      if (!objectId?.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'objectId is required' });
        return;
      }
      const result = await connectorFetch(cfg.kind, cfg, objectId);
      res.json(result);
    } catch (err) { next(err); }
  });

  router.post('/api/connectors/:id/search', authenticate, async (req, res, next) => {
    try {
      const cfg = getConnectorConfig(String(req.params['id']));
      const { query } = req.body as { query: string };
      if (!query?.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'query is required' });
        return;
      }
      const results = await connectorSearch(cfg.kind, cfg, query);
      res.json({ results });
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
