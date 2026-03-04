// @jowork/core/channels/router — REST API for channel plugin management
//
// Routes (all require admin role):
//   GET  /api/channels               — list all registered channel plugins + status
//   POST /api/channels/:id/init      — initialize a channel with provided config
//   POST /api/channels/:id/message   — send a text message via channel
//   POST /api/channels/:id/shutdown  — shutdown a channel
//
// Auto-initialization on startup (from environment variables):
//   TELEGRAM_BOT_TOKEN + optional TELEGRAM_WEBHOOK_URL
//   DISCORD_WEBHOOK_URL  (webhook mode)  OR
//   DISCORD_BOT_TOKEN + DISCORD_CHANNEL_ID  (bot mode)

import { Router } from 'express';
import { authenticate, requireRole } from '../gateway/index.js';
import { logger } from '../utils/index.js';
import { telegramChannel } from './telegram.js';
import { discordChannel } from './discord.js';
import {
  registerChannelPlugin,
  getChannelPlugin,
  listChannelPlugins,
  markChannelInitialized,
  markChannelShutdown,
  isChannelInitialized,
} from './protocol.js';
import type { ChannelConfig, ChannelTarget } from './protocol.js';

// ─── Auto-register built-in channel plugins ───────────────────────────────────
// Runs at module load; mirrors how JCP connectors auto-register in connectors/index.ts

registerChannelPlugin(telegramChannel);
registerChannelPlugin(discordChannel);

// ─── Env-based auto-initialization ───────────────────────────────────────────

async function autoInitFromEnv(): Promise<void> {
  const tgToken = process.env['TELEGRAM_BOT_TOKEN'];
  if (tgToken && !isChannelInitialized('telegram')) {
    try {
      const cfg: ChannelConfig = { botToken: tgToken };
      const webhookUrl = process.env['TELEGRAM_WEBHOOK_URL'];
      if (webhookUrl) cfg['webhookUrl'] = webhookUrl;
      await telegramChannel.initialize(cfg);
      markChannelInitialized('telegram');
      logger.info('Telegram channel auto-initialized');
    } catch (err) {
      logger.warn('Telegram auto-init failed', { err: String(err) });
    }
  }

  const discordWebhook = process.env['DISCORD_WEBHOOK_URL'];
  const discordToken   = process.env['DISCORD_BOT_TOKEN'];
  const discordChannel_id = process.env['DISCORD_CHANNEL_ID'];

  if ((discordWebhook || discordToken) && !isChannelInitialized('discord')) {
    try {
      const cfg: ChannelConfig = {};
      if (discordWebhook) cfg['webhookUrl'] = discordWebhook;
      if (discordToken)   cfg['botToken']   = discordToken;
      if (discordChannel_id) cfg['channelId'] = discordChannel_id;
      await discordChannel.initialize(cfg);
      markChannelInitialized('discord');
      logger.info('Discord channel auto-initialized');
    } catch (err) {
      logger.warn('Discord auto-init failed', { err: String(err) });
    }
  }
}

// Fire-and-forget; non-blocking startup
void autoInitFromEnv();

// ─── Router ───────────────────────────────────────────────────────────────────

export function channelsRouter(): Router {
  const router = Router();

  // List all registered channel plugins with initialization status
  router.get('/api/channels', authenticate, (_req, res) => {
    res.json(listChannelPlugins());
  });

  // Initialize (or re-initialize) a channel with provided config
  router.post('/api/channels/:id/init', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const id      = String(req.params['id']);
      const channel = getChannelPlugin(id);
      if (!channel) {
        res.status(404).json({ error: `Channel '${id}' not found` });
        return;
      }

      // Shutdown first if already initialized
      if (isChannelInitialized(id)) {
        await channel.shutdown();
        markChannelShutdown(id);
      }

      const config = (req.body as { config?: ChannelConfig }).config ?? (req.body as ChannelConfig);
      await channel.initialize(config);
      markChannelInitialized(id);

      res.json({ id, initialized: true });
    } catch (err) { next(err); }
  });

  // Send a text message via a channel
  router.post('/api/channels/:id/message', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const id      = String(req.params['id']);
      const channel = getChannelPlugin(id);
      if (!channel) {
        res.status(404).json({ error: `Channel '${id}' not found` });
        return;
      }
      if (!isChannelInitialized(id)) {
        res.status(409).json({ error: `Channel '${id}' is not initialized. Call POST /api/channels/${id}/init first.` });
        return;
      }

      const { target, text } = req.body as { target?: ChannelTarget; text: string };
      const channelTarget: ChannelTarget = target ?? { id: '', type: 'user' };

      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'text is required' });
        return;
      }

      await channel.sendText(channelTarget, text);
      res.json({ sent: true, channelId: id });
    } catch (err) { next(err); }
  });

  // Shutdown a channel
  router.post('/api/channels/:id/shutdown', authenticate, requireRole('admin'), async (req, res, next) => {
    try {
      const id      = String(req.params['id']);
      const channel = getChannelPlugin(id);
      if (!channel) {
        res.status(404).json({ error: `Channel '${id}' not found` });
        return;
      }

      await channel.shutdown();
      markChannelShutdown(id);

      res.json({ id, initialized: false });
    } catch (err) { next(err); }
  });

  return router;
}
