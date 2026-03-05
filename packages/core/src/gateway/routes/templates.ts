// @jowork/core/gateway/routes/templates — conversation template endpoints
//
// Routes:
//   GET    /api/templates           — list templates (user-owned + builtins)
//   POST   /api/templates           — create a custom template
//   GET    /api/templates/:id       — get single template
//   PATCH  /api/templates/:id       — update a custom template
//   DELETE /api/templates/:id       — delete a custom template

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { CreateTemplateInput, UpdateTemplateInput } from '../../templates/index.js';
import {
  listTemplates,
  createTemplate,
  getTemplate,
  updateTemplate,
  deleteTemplate,
} from '../../templates/index.js';

export function templatesRouter(): Router {
  const router = Router();

  router.get('/api/templates', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const templates = listTemplates(userId);
      res.json(templates);
    } catch (err) { next(err); }
  });

  router.post('/api/templates', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const body = req.body as Record<string, string>;
      const name = body['name'];
      if (!name) {
        res.status(400).json({ message: 'name is required' });
        return;
      }
      const input: CreateTemplateInput = { name, ownerId: userId };
      if (body['description']) input.description = body['description'];
      if (body['systemPrompt']) input.systemPrompt = body['systemPrompt'];
      if (body['firstMessage']) input.firstMessage = body['firstMessage'];
      if (body['icon']) input.icon = body['icon'];
      const template = createTemplate(input);
      res.status(201).json(template);
    } catch (err) { next(err); }
  });

  router.get('/api/templates/:id', authenticate, (req, res, next) => {
    try {
      const id = req.params['id'] as string;
      const template = getTemplate(id);
      if (!template) {
        res.status(404).json({ message: 'Template not found' });
        return;
      }
      res.json(template);
    } catch (err) { next(err); }
  });

  router.patch('/api/templates/:id', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const id = req.params['id'] as string;
      const body = req.body as Record<string, string>;
      const input: UpdateTemplateInput = {};
      if (body['name'] !== undefined) input.name = body['name'];
      if (body['description'] !== undefined) input.description = body['description'];
      if (body['systemPrompt'] !== undefined) input.systemPrompt = body['systemPrompt'];
      if (body['firstMessage'] !== undefined) input.firstMessage = body['firstMessage'];
      if (body['icon'] !== undefined) input.icon = body['icon'];
      const updated = updateTemplate(id, userId, input);
      if (!updated) {
        res.status(404).json({ message: 'Template not found or cannot be edited' });
        return;
      }
      res.json(updated);
    } catch (err) { next(err); }
  });

  router.delete('/api/templates/:id', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const id = req.params['id'] as string;
      const deleted = deleteTemplate(id, userId);
      if (!deleted) {
        res.status(404).json({ message: 'Template not found or cannot be deleted' });
        return;
      }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
