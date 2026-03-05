// @jowork/core/gateway/routes/models — Model provider discovery + configuration
//
// Routes:
//   GET    /api/models/providers             — list all registered providers
//   POST   /api/models/providers             — add a custom provider
//   PATCH  /api/models/providers/:id         — update a custom provider
//   DELETE /api/models/providers/:id         — delete a custom provider
//   GET    /api/models/ollama/discover       — auto-discover running Ollama models
//   GET    /api/models/active                — active provider + model from env
//   PUT    /api/models/active                — switch active provider + model (runtime)

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { listModelProviders, discoverOllamaModels, getModelProvider } from '../../models/index.js';
import {
  createCustomProvider,
  updateCustomProvider,
  deleteCustomProvider,
  type CreateProviderInput,
  type UpdateProviderInput,
} from '../../models/store.js';

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

  /** Add a custom model provider */
  router.post('/api/models/providers', authenticate, (req, res, next) => {
    try {
      const body = req.body as Partial<CreateProviderInput>;
      if (!body.id || !body.name || !body.apiFormat || !body.endpoint) {
        res.status(400).json({ message: 'id, name, apiFormat, and endpoint are required' });
        return;
      }
      if (body.apiFormat !== 'anthropic' && body.apiFormat !== 'openai') {
        res.status(400).json({ message: 'apiFormat must be "anthropic" or "openai"' });
        return;
      }
      const provider = createCustomProvider(body as CreateProviderInput);
      res.status(201).json(provider);
    } catch (err) { next(err); }
  });

  /** Update a custom model provider */
  router.patch('/api/models/providers/:id', authenticate, (req, res, next) => {
    try {
      const body = req.body as UpdateProviderInput;
      if (body.apiFormat && body.apiFormat !== 'anthropic' && body.apiFormat !== 'openai') {
        res.status(400).json({ message: 'apiFormat must be "anthropic" or "openai"' });
        return;
      }
      const provider = updateCustomProvider(String(req.params['id']), body);
      if (!provider) {
        res.status(404).json({ message: 'Provider not found' });
        return;
      }
      res.json(provider);
    } catch (err) { next(err); }
  });

  /** Delete a custom model provider */
  router.delete('/api/models/providers/:id', authenticate, (req, res, next) => {
    try {
      const deleted = deleteCustomProvider(String(req.params['id']));
      if (!deleted) {
        res.status(404).json({ message: 'Provider not found' });
        return;
      }
      res.json({ deleted: true });
    } catch (err) { next(err); }
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
