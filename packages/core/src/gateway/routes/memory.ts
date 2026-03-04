// @jowork/core/gateway/routes/memory — Memory management REST API
//
// Routes:
//   GET    /api/memories       — list/search memories for authenticated user
//   POST   /api/memories       — save a new memory
//   DELETE /api/memories/:id   — delete a memory

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { saveMemory, searchMemory, deleteMemory } from '../../memory/index.js';

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
