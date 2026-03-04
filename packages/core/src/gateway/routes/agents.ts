// @jowork/core/gateway/routes/agents — Agent management REST API
//
// Routes:
//   GET    /api/agents          — list agents owned by authenticated user
//   POST   /api/agents          — create a new agent
//   GET    /api/agents/:id      — get agent by id (owner only)
//   PATCH  /api/agents/:id      — update name/systemPrompt/model
//   DELETE /api/agents/:id      — delete agent (owner only)
//   GET    /api/agent/tools     — list available built-in tools + schemas

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getDb } from '../../datamap/index.js';
import { generateId, nowISO } from '../../utils/index.js';
import type { AgentConfig } from '../../types.js';
import { getToolSchemas } from '../../agent/tools/index.js';

interface AgentRow {
  id: string;
  name: string;
  owner_id: string;
  system_prompt: string;
  model: string;
  created_at: string;
}

function rowToAgent(row: AgentRow): AgentConfig {
  return {
    id:           row.id,
    name:         row.name,
    ownerId:      row.owner_id,
    systemPrompt: row.system_prompt,
    model:        row.model,
    createdAt:    row.created_at,
  };
}

export function agentsRouter(): Router {
  const router = Router();

  // List agents for the authenticated user
  router.get('/api/agents', authenticate, (req, res, next) => {
    try {
      const db     = getDb();
      const userId = req.auth!.userId;
      const rows   = db.prepare(
        `SELECT * FROM agents WHERE owner_id = ? ORDER BY created_at DESC`,
      ).all(userId) as AgentRow[];
      res.json(rows.map(rowToAgent));
    } catch (err) { next(err); }
  });

  // Create a new agent
  router.post('/api/agents', authenticate, (req, res, next) => {
    try {
      const db     = getDb();
      const userId = req.auth!.userId;
      const { name, systemPrompt, model } =
        req.body as { name?: string; systemPrompt?: string; model?: string };

      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'name is required' });
        return;
      }

      const agent: AgentConfig = {
        id:           generateId(),
        name,
        ownerId:      userId,
        systemPrompt: systemPrompt ?? 'You are a helpful AI coworker.',
        model:        model ?? 'claude-3-5-sonnet-latest',
        createdAt:    nowISO(),
      };

      db.prepare(
        `INSERT INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(agent.id, agent.name, agent.ownerId, agent.systemPrompt, agent.model, agent.createdAt);

      res.status(201).json(agent);
    } catch (err) { next(err); }
  });

  // Get agent by id — owner only
  router.get('/api/agents/:id', authenticate, (req, res, next) => {
    try {
      const db     = getDb();
      const userId = req.auth!.userId;
      const row    = db.prepare(
        `SELECT * FROM agents WHERE id = ? AND owner_id = ?`,
      ).get(String(req.params['id']), userId) as AgentRow | undefined;

      if (!row) { res.status(404).json({ error: 'NOT_FOUND' }); return; }
      res.json(rowToAgent(row));
    } catch (err) { next(err); }
  });

  // Partial update — name, systemPrompt, model
  router.patch('/api/agents/:id', authenticate, (req, res, next) => {
    try {
      const db     = getDb();
      const userId = req.auth!.userId;
      const id     = String(req.params['id']);

      const existing = db.prepare(
        `SELECT * FROM agents WHERE id = ? AND owner_id = ?`,
      ).get(id, userId) as AgentRow | undefined;

      if (!existing) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      const { name, systemPrompt, model } =
        req.body as { name?: string; systemPrompt?: string; model?: string };

      const newName   = name         ?? existing.name;
      const newPrompt = systemPrompt ?? existing.system_prompt;
      const newModel  = model        ?? existing.model;

      db.prepare(
        `UPDATE agents SET name = ?, system_prompt = ?, model = ? WHERE id = ?`,
      ).run(newName, newPrompt, newModel, id);

      res.json({ id, name: newName, systemPrompt: newPrompt, model: newModel });
    } catch (err) { next(err); }
  });

  // List built-in tool schemas — useful for UI and LLM system prompt construction
  router.get('/api/agent/tools', authenticate, (_req, res) => {
    res.json({ tools: getToolSchemas() });
  });

  // Delete agent — owner only
  router.delete('/api/agents/:id', authenticate, (req, res, next) => {
    try {
      const db     = getDb();
      const userId = req.auth!.userId;
      const id     = String(req.params['id']);

      const existing = db.prepare(
        `SELECT id FROM agents WHERE id = ? AND owner_id = ?`,
      ).get(id, userId) as { id: string } | undefined;

      if (!existing) { res.status(404).json({ error: 'NOT_FOUND' }); return; }

      db.prepare(`DELETE FROM agents WHERE id = ?`).run(id);
      res.status(204).end();
    } catch (err) { next(err); }
  });

  return router;
}
