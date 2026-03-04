// apps/fluxvita — memory management routes (same as jowork, uses @jowork/core)

import { Router } from 'express';
import { authenticate, saveMemory, searchMemory, deleteMemory } from '@jowork/core';

export function memoryRouter(): Router {
  const router = Router();

  router.get('/api/memories', authenticate, (req, res, next) => {
    try {
      const q = req.query['q'];
      const opts = q ? { query: String(q), userId: req.auth!.userId } : { userId: req.auth!.userId };
      const results = searchMemory(opts);
      res.json(results);
    } catch (err) { next(err); }
  });

  router.post('/api/memories', authenticate, (req, res, next) => {
    try {
      const { content, tags, source } = req.body as { content: string; tags?: string[]; source?: string };
      if (!content?.trim()) { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
      const saveOpts: { tags?: string[]; source?: string } = {};
      if (tags) saveOpts.tags = tags;
      if (source) saveOpts.source = source;
      const entry = saveMemory(req.auth!.userId, content, saveOpts);
      res.status(201).json(entry);
    } catch (err) { next(err); }
  });

  router.delete('/api/memories/:id', authenticate, (req, res, next) => {
    try {
      deleteMemory(String(req.params['id']));
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
