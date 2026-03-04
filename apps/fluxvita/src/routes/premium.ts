// apps/fluxvita — premium-specific routes
// Exposes FluxVita-exclusive API endpoints: edition info, klaude status, Feishu OAuth stub

import { Router } from 'express';
import { authenticate, requireRole, getEdition } from '@jowork/core';
import { isKlaudeRunning, startKlaude, getKlaudeBaseUrl } from '@jowork/premium';

export function premiumRouter(): Router {
  const router = Router();

  // Edition info — shows which premium features are active
  router.get('/api/premium/edition', authenticate, (_req, res) => {
    const edition = getEdition();
    res.json({
      agentEngines: edition.agentEngines,
      hasGeekMode: edition.hasGeekMode,
      hasVectorMemory: edition.hasVectorMemory,
      hasSubAgent: edition.hasSubAgent,
      hasEventTrigger: edition.hasEventTrigger,
      maxDataSources: edition.maxDataSources,
      maxUsers: edition.maxUsers,
    });
  });

  // Klaude status — check if local Claude proxy is running
  router.get('/api/premium/klaude', authenticate, requireRole('admin'), async (_req, res, next) => {
    try {
      const running = await isKlaudeRunning();
      res.json({ running, url: running ? getKlaudeBaseUrl() : null });
    } catch (err) { next(err); }
  });

  // Start Klaude if not running
  router.post('/api/premium/klaude/start', authenticate, requireRole('admin'), async (_req, res, next) => {
    try {
      await startKlaude();
      const running = await isKlaudeRunning();
      res.json({ started: running });
    } catch (err) { next(err); }
  });

  // Feishu OAuth callback stub — FluxVita-specific, actual OAuth handled externally
  // In production, FEISHU_APP_ID and FEISHU_APP_SECRET are loaded from .env
  router.get('/api/feishu/oauth/callback', (_req, res) => {
    const appId = process.env['FEISHU_APP_ID'];
    if (!appId) {
      res.status(503).json({ error: 'FEISHU_NOT_CONFIGURED', message: 'Set FEISHU_APP_ID and FEISHU_APP_SECRET in .env' });
      return;
    }
    // TODO: implement Feishu OAuth code exchange (Phase 6+)
    res.json({ status: 'ok', note: 'Feishu OAuth integration pending Phase 6' });
  });

  return router;
}
