// @jowork/core/gateway/routes/models — Model provider discovery + configuration
//
// Routes:
//   GET  /api/models/providers           — list all registered providers
//   GET  /api/models/ollama/discover     — auto-discover running Ollama models
//   GET  /api/models/active              — active provider + model from env
//   PUT  /api/models/active              — switch active provider + model (runtime)

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { listModelProviders, discoverOllamaModels, getModelProvider } from '../../models/index.js';

export function modelsRouter(): Router {
  const router = Router();

  /** List all registered model providers */
  router.get('/api/models/providers', authenticate, (_req, res) => {
    const providers = listModelProviders().map(p => ({
      id: p.id,
      name: p.name,
      apiFormat: p.apiFormat,
      endpoint: p.endpoint,
      models: p.models,
    }));
    res.json({ providers });
  });

  /** Auto-discover locally running Ollama models */
  router.get('/api/models/ollama/discover', authenticate, async (_req, res, next) => {
    try {
      const models = await discoverOllamaModels();
      res.json({ available: models.length > 0, models });
    } catch (err) { next(err); }
  });

  /** Return the currently active provider + model resolved from env */
  router.get('/api/models/active', authenticate, (_req, res) => {
    const providerId = process.env['MODEL_PROVIDER'] ?? 'anthropic';
    const modelId    = process.env['MODEL_NAME']     ?? 'claude-3-5-sonnet-latest';
    const providers  = listModelProviders();
    const provider   = providers.find(p => p.id === providerId);
    res.json({
      provider: providerId,
      model: modelId,
      providerName: provider?.name ?? providerId,
      apiFormat: provider?.apiFormat ?? 'unknown',
    });
  });

  /** Switch active provider + model at runtime (persists until restart) */
  router.put('/api/models/active', authenticate, (req, res) => {
    const { provider: providerId, model: modelId } = req.body as { provider?: string; model?: string };
    if (!providerId || !modelId) {
      res.status(400).json({ message: 'provider and model are required' });
      return;
    }
    const provider = getModelProvider(providerId);
    if (!provider) {
      res.status(400).json({ message: `Unknown provider: ${providerId}` });
      return;
    }
    process.env['MODEL_PROVIDER'] = providerId;
    process.env['MODEL_NAME']     = modelId;
    res.json({
      provider: providerId,
      model: modelId,
      providerName: provider.name,
      apiFormat: provider.apiFormat,
    });
  });

  return router;
}
