// @jowork/core/gateway/routes/webhooks — webhook subscription management
//
// Routes:
//   GET    /api/webhooks           — list webhook subscriptions
//   POST   /api/webhooks           — create a new webhook subscription
//   PATCH  /api/webhooks/:id       — toggle active/inactive
//   DELETE /api/webhooks/:id       — delete a webhook subscription
//   POST   /api/webhooks/:id/test  — send a test event

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import type { WebhookEventType } from '../../webhooks/index.js';
import {
  listWebhooks,
  createWebhook,
  getWebhook,
  toggleWebhook,
  deleteWebhook,
  emitWebhookEvent,
} from '../../webhooks/index.js';

const VALID_EVENTS: WebhookEventType[] = ['message.created', 'session.created', 'session.deleted', 'connector.synced', 'memory.created', 'agent.updated'];

export function webhooksRouter(): Router {
  const router = Router();

  router.get('/api/webhooks', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const webhooks = listWebhooks(userId);
      // Mask secrets in response
      res.json(webhooks.map(w => ({ ...w, secret: w.secret.slice(0, 8) + '...' })));
    } catch (err) { next(err); }
  });

  router.post('/api/webhooks', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const body = req.body as Record<string, unknown>;
      const url = body['url'] as string | undefined;
      const events = body['events'] as string[] | undefined;

      if (!url || typeof url !== 'string') {
        res.status(400).json({ message: 'url is required' });
        return;
      }
      if (!events || !Array.isArray(events) || events.length === 0) {
        res.status(400).json({ message: 'events array is required (non-empty)' });
        return;
      }
      for (const e of events) {
        if (!VALID_EVENTS.includes(e as WebhookEventType)) {
          res.status(400).json({ message: `Invalid event type: ${e}. Valid: ${VALID_EVENTS.join(', ')}` });
          return;
        }
      }

      const webhook = createWebhook({ url, events: events as WebhookEventType[], ownerId: userId });
      res.status(201).json(webhook);
    } catch (err) { next(err); }
  });

  router.patch('/api/webhooks/:id', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const id = req.params['id'] as string;
      const body = req.body as Record<string, unknown>;
      const isActive = body['isActive'];
      if (typeof isActive !== 'boolean') {
        res.status(400).json({ message: 'isActive (boolean) is required' });
        return;
      }
      const toggled = toggleWebhook(id, userId, isActive);
      if (!toggled) {
        res.status(404).json({ message: 'Webhook not found' });
        return;
      }
      const updated = getWebhook(id);
      res.json(updated);
    } catch (err) { next(err); }
  });

  router.delete('/api/webhooks/:id', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const id = req.params['id'] as string;
      const deleted = deleteWebhook(id, userId);
      if (!deleted) {
        res.status(404).json({ message: 'Webhook not found' });
        return;
      }
      res.status(204).end();
    } catch (err) { next(err); }
  });

  router.post('/api/webhooks/:id/test', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const id = req.params['id'] as string;
      const webhook = getWebhook(id);
      if (!webhook || webhook.ownerId !== userId) {
        res.status(404).json({ message: 'Webhook not found' });
        return;
      }
      emitWebhookEvent('session.created', { test: true, webhookId: id });
      res.json({ message: 'Test event dispatched' });
    } catch (err) { next(err); }
  });

  return router;
}
