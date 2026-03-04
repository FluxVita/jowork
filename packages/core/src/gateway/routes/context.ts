// @jowork/core/gateway/routes/context — Three-layer context system REST API
//
// Routes:
//   GET    /api/context               — list context docs (filter by layer/scopeId/docType)
//   GET    /api/context/:id           — get single context doc
//   POST   /api/context               — create a context doc
//   PUT    /api/context/:id           — update a context doc
//   DELETE /api/context/:id           — delete a context doc
//   PUT    /api/context/workstyle     — upsert personal workstyle doc shortcut
//   POST   /api/context/assemble      — assemble context for agent use

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { assertRole } from '../../policy/index.js';
import {
  assembleContext,
  createContextDoc,
  deleteContextDoc,
  getContextDoc,
  listContextDocs,
  saveWorkstyleDoc,
  updateContextDoc,
} from '../../context/index.js';
import type { ListContextDocsOptions } from '../../context/index.js';
import type { ContextDocType, ContextLayer } from '../../types.js';

export function contextRouter(): Router {
  const router = Router();

  router.get('/api/context', authenticate, (req, res, next) => {
    try {
      const q = req.query as Record<string, string>;
      const opts: ListContextDocsOptions = {};
      if (q['layer'])   opts.layer   = q['layer'] as ContextLayer;
      if (q['scopeId']) opts.scopeId = q['scopeId'];
      if (q['docType']) opts.docType = q['docType'] as ContextDocType;
      res.json(listContextDocs(opts));
    } catch (err) { next(err); }
  });

  router.get('/api/context/:id', authenticate, (req, res, next) => {
    try {
      const doc = getContextDoc(String(req.params['id']));
      if (!doc) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      res.json(doc);
    } catch (err) { next(err); }
  });

  router.post('/api/context', authenticate, (req, res, next) => {
    try {
      const body = req.body as {
        layer?: unknown; scopeId?: unknown; title?: unknown;
        content?: unknown; docType?: unknown; isForced?: unknown;
      };

      const layer   = body.layer   as ContextLayer | undefined;
      const scopeId = body.scopeId as string | undefined;
      const title   = body.title   as string | undefined;
      const content = body.content as string | undefined;

      if (!layer || !scopeId || !title?.trim() || !content?.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT' }); return;
      }

      const isForced = Boolean(body.isForced);
      if (layer !== 'personal' || isForced) {
        assertRole(req.auth!.role, 'admin');
      }

      const input: Parameters<typeof createContextDoc>[0] = {
        layer, scopeId, title, content, createdBy: req.auth!.userId,
      };
      if (body.docType) input.docType = body.docType as ContextDocType;
      if (isForced) input.isForced = true;

      res.status(201).json(createContextDoc(input));
    } catch (err) { next(err); }
  });

  router.put('/api/context/workstyle', authenticate, (req, res, next) => {
    try {
      const { content } = req.body as { content?: string };
      if (!content?.trim()) { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
      res.json(saveWorkstyleDoc(req.auth!.userId, content));
    } catch (err) { next(err); }
  });

  router.put('/api/context/:id', authenticate, (req, res, next) => {
    try {
      const doc = getContextDoc(String(req.params['id']));
      if (!doc) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      if (doc.layer !== 'personal' || doc.scopeId !== req.auth!.userId) {
        assertRole(req.auth!.role, 'admin');
      }

      const body = req.body as { title?: string; content?: string; isForced?: boolean };
      const patch: Parameters<typeof updateContextDoc>[1] = {};
      if (body.title   !== undefined) patch.title    = body.title;
      if (body.content !== undefined) patch.content  = body.content;
      if (body.isForced !== undefined) patch.isForced = body.isForced;

      res.json(updateContextDoc(doc.id, patch));
    } catch (err) { next(err); }
  });

  router.delete('/api/context/:id', authenticate, (req, res, next) => {
    try {
      const doc = getContextDoc(String(req.params['id']));
      if (!doc) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      if (doc.layer !== 'personal' || doc.scopeId !== req.auth!.userId) {
        assertRole(req.auth!.role, 'admin');
      }

      deleteContextDoc(doc.id);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  router.post('/api/context/assemble', authenticate, (req, res, next) => {
    try {
      const { query } = req.body as { query?: string };
      if (query === undefined) { res.status(400).json({ error: 'INVALID_INPUT' }); return; }
      res.json(assembleContext({ userId: req.auth!.userId, query }));
    } catch (err) { next(err); }
  });

  return router;
}
