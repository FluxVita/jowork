// @jowork/core/gateway/routes/scheduler — CRUD REST API for scheduler tasks
//
// Routes (authenticated user sees only their own tasks):
//   GET    /api/tasks            — list tasks for current user
//   POST   /api/tasks            — create a new task
//   PATCH  /api/tasks/:id        — toggle enabled (body: { enabled: boolean })
//   DELETE /api/tasks/:id        — delete a task

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import {
  createTask,
  listTasks,
  toggleTask,
  deleteTask,
} from '../../scheduler/index.js';

export function schedulerRouter(): Router {
  const router = Router();

  // List all tasks for the authenticated user
  router.get('/api/tasks', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      res.json(listTasks(userId));
    } catch (err) { next(err); }
  });

  // Create a new scheduled task
  router.post('/api/tasks', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const { agentId, name, cronExpr, action, params, enabled } =
        req.body as {
          agentId?: string;
          name: string;
          cronExpr: string;
          action: string;
          params?: Record<string, unknown>;
          enabled?: boolean;
        };

      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
      }
      if (!cronExpr || typeof cronExpr !== 'string') {
        res.status(400).json({ error: 'cronExpr is required (5-part cron string)' });
        return;
      }
      if (!action || typeof action !== 'string') {
        res.status(400).json({ error: 'action is required' });
        return;
      }

      const task = createTask({
        userId,
        agentId: agentId ?? 'default',
        name,
        cronExpr,
        action,
        params: params ?? {},
        enabled: enabled !== false,
      });

      res.status(201).json(task);
    } catch (err) { next(err); }
  });

  // Toggle enabled flag
  router.patch('/api/tasks/:id', authenticate, (req, res, next) => {
    try {
      const id = String(req.params['id']);
      const { enabled } = req.body as { enabled?: boolean };

      if (typeof enabled !== 'boolean') {
        res.status(400).json({ error: 'enabled (boolean) is required' });
        return;
      }

      toggleTask(id, enabled);
      res.json({ id, enabled });
    } catch (err) { next(err); }
  });

  // Delete a task
  router.delete('/api/tasks/:id', authenticate, (req, res, next) => {
    try {
      const id = String(req.params['id']);
      deleteTask(id);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
