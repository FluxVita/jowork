// @jowork/core/gateway/routes/terminal — Geek Mode basic terminal REST API
//
// Routes:
//   POST   /api/terminal/exec       — run a shell command in a session
//   GET    /api/terminal            — get current session info (cwd, etc.)
//   DELETE /api/terminal            — reset session (cwd back to home)
//
// Session ID: uses the authenticated user ID as the session key.
// In personal mode this is always 'personal', giving one persistent session.

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { execInSession, getSessionInfo, resetSession } from '../../terminal/index.js';

export function terminalRouter(): Router {
  const router = Router();

  // Run a command — POST /api/terminal/exec
  // Body: { command: string, timeoutMs?: number }
  // Returns: { stdout, stderr, exitCode, cwd }
  router.post('/api/terminal/exec', authenticate, async (req, res, next) => {
    try {
      const { command, timeoutMs } = req.body as { command?: string; timeoutMs?: number };
      if (!command || typeof command !== 'string' || !command.trim()) {
        res.status(400).json({ error: 'INVALID_INPUT', message: 'command is required' });
        return;
      }

      const sessionId = req.auth!.userId;
      const result = await execInSession(sessionId, command.trim(), timeoutMs);
      res.json(result);
    } catch (err) { next(err); }
  });

  // Get current terminal session info — GET /api/terminal
  // Returns: { id, cwd, createdAt }
  router.get('/api/terminal', authenticate, (req, res, next) => {
    try {
      const sessionId = req.auth!.userId;
      res.json(getSessionInfo(sessionId));
    } catch (err) { next(err); }
  });

  // Reset session (cd back to home) — DELETE /api/terminal
  // Returns: { id, cwd, createdAt }
  router.delete('/api/terminal', authenticate, (req, res, next) => {
    try {
      const sessionId = req.auth!.userId;
      res.json(resetSession(sessionId));
    } catch (err) { next(err); }
  });

  return router;
}
