/**
 * gateway/routes/hooks.ts — Phase 3.3: Webhook Endpoints
 *
 * POST /api/hooks/wake — 向 main session 注入系统事件
 * POST /api/hooks/agent — 触发一次 isolated agent turn
 * POST /api/hooks/:name — 自定义 webhook → agent turn 映射
 *
 * 认证：Authorization: Bearer <WEBHOOK_SECRET>
 */
import { Router } from 'express';
import { config as gatewayConfig } from '../../config.js';
import { agentChat } from '../../agent/controller.js';
import { createSession } from '../../agent/session.js';
import type { AgentEvent } from '../../agent/types.js';
import { emit } from '../../hooks/engine.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('hooks-route');
const router = Router();

// ─── Webhook 认证中间件 ───

function webhookAuth(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction): void {
  const secret = gatewayConfig.webhookSecret;
  if (!secret) {
    res.status(503).json({ error: 'Webhook secret not configured' });
    return;
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== secret) {
    res.status(403).json({ error: 'Invalid webhook token' });
    return;
  }

  next();
}

// ─── POST /api/hooks/wake ───
// 注入系统事件到 hooks engine

router.post('/wake', webhookAuth, async (req, res) => {
  try {
    const { text, mode } = req.body as { text?: string; mode?: 'now' | 'next-heartbeat' };

    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    emit('gateway:startup', { source: 'webhook', text, mode: mode ?? 'now' });

    log.info(`Wake event received: ${text.slice(0, 100)}`);
    res.json({ ok: true, message: 'Wake event dispatched' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Wake hook failed:', err);
    res.status(500).json({ error: msg });
  }
});

// ─── POST /api/hooks/agent ───
// 触发一次 isolated agent turn

router.post('/agent', webhookAuth, async (req, res) => {
  try {
    const {
      message,
      session_key,
      model,
      deliver,
      channel,
      to,
      timeout_seconds,
    } = req.body as {
      message?: string;
      session_key?: string;
      model?: string;
      deliver?: boolean;
      channel?: string;
      to?: string;
      timeout_seconds?: number;
    };

    if (!message) {
      res.status(400).json({ error: 'message is required' });
      return;
    }

    // 创建 isolated session
    const sessionTitle = session_key ? `webhook:${session_key}` : 'webhook:agent';
    const session = createSession('system', sessionTitle, 'builtin', { sessionType: 'webhook' });
    const sessionId = session.session_id;

    log.info(`Webhook agent turn started: session=${sessionId}`);

    // 运行 agent（带超时）
    const timeoutMs = (timeout_seconds ?? 120) * 1000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let output = '';
    let lastError = '';

    try {
      const events = agentChat({
        userId: 'system',
        role: 'admin',
        sessionId,
        message,
        signal: controller.signal,
      });

      for await (const event of events) {
        if (event.event === 'text_done') {
          output = (event as Extract<AgentEvent, { event: 'text_done' }>).data.content;
        } else if (event.event === 'error') {
          lastError = (event as Extract<AgentEvent, { event: 'error' }>).data.message;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    // 可选 delivery
    if (deliver && output && (channel || to)) {
      try {
        const { feishuApi } = await import('../../connectors/feishu/auth.js');
        const receiveId = to || channel;
        const receiveType = to ? 'open_id' : 'chat_id';
        await feishuApi(`/im/v1/messages`, {
          method: 'POST',
          params: { receive_id_type: receiveType! },
          body: {
            receive_id: receiveId,
            msg_type: 'text',
            content: JSON.stringify({ text: output.slice(0, 4000) }),
          },
        });
      } catch (err) {
        log.error('Webhook delivery failed:', err);
      }
    }

    res.json({
      ok: true,
      session_id: sessionId,
      output: output || lastError,
      status: lastError ? 'error' : 'success',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('Agent hook failed:', err);
    res.status(500).json({ error: msg });
  }
});

export default router;
