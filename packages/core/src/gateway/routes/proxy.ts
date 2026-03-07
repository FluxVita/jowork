/**
 * LLM 代理层（Phase 3）
 * SaaS 用户的 LLM 请求经此代理，实现服务端计次（不靠自报），不持久化对话内容。
 *
 * 仅在 JOWORK_CLOUD_MODE=true 时启用（Mac mini 侧）。
 */

import { Router, type Request, type Response } from 'express';
import { authMiddleware } from '../middleware.js';
import { isCloudHosted, checkCreditSufficient, deductOneConversation } from '../../billing/credits.js';
import { getDb } from '../../datamap/db.js';
import { getOrgSetting } from '../../auth/settings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('proxy');
const router = Router();

// ─── 速率限制（per-IP，每分钟最多 20 次代理请求）───
const _ipRateMap = new Map<string, { count: number; windowStart: number }>();

function checkProxyRateLimit(ip: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 60_000;
  const MAX_REQ = 20;
  const state = _ipRateMap.get(ip) ?? { count: 0, windowStart: now };
  if (now - state.windowStart >= WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }
  state.count++;
  _ipRateMap.set(ip, state);
  return state.count <= MAX_REQ;
}

/**
 * POST /api/proxy/chat
 * SaaS 用户 LLM 代理：
 * 1. 验证 JWT + 检查对话次数余量
 * 2. 使用平台 Key 转发到 OpenRouter（流式）
 * 3. 响应完成后扣 1 次对话（不持久化内容）
 */
router.post('/chat', authMiddleware, async (req: Request, res: Response) => {
  if (!isCloudHosted()) {
    res.status(503).json({ error: 'Proxy only available in cloud mode' });
    return;
  }

  const clientIp = (req.headers['x-forwarded-for'] as string | undefined) ?? req.ip ?? 'unknown';
  if (!checkProxyRateLimit(clientIp)) {
    res.status(429).json({ error: 'Rate limit exceeded. Please wait a moment.' });
    return;
  }

  const userId = req.user!.user_id;

  // 检查对话次数余量
  if (!checkCreditSufficient(userId)) {
    res.status(402).json({
      error: 'quota_exhausted',
      message: 'Monthly conversation quota exceeded. Please upgrade your plan.',
    });
    return;
  }

  const { messages, model_preference, session_id } = req.body as {
    messages: Array<{ role: string; content: string }>;
    model_preference?: string;
    session_id?: string;
  };

  if (!messages || !Array.isArray(messages)) {
    res.status(400).json({ error: 'messages array required' });
    return;
  }

  // 获取平台 OpenRouter Key（org 级，不是用户 key）
  const apiKey = getOrgSetting('model_api_key_openrouter') ?? process.env['OPENROUTER_API_KEY'];
  if (!apiKey) {
    res.status(500).json({ error: 'Platform API key not configured' });
    return;
  }

  const model = model_preference ?? 'anthropic/claude-3-5-haiku';

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  let completionReceived = false;

  try {
    const upstream = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://jowork.work',
        'X-Title': 'JoWork',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 4096,
      }),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '');
      res.write(`data: ${JSON.stringify({ error: `Upstream ${upstream.status}: ${errText.slice(0, 200)}` })}\n\n`);
      res.end();
      return;
    }

    const reader = upstream.body?.getReader();
    if (!reader) { res.end(); return; }

    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) { completionReceived = true; break; }
      res.write(decoder.decode(value, { stream: true }));
    }

    res.end();

    // 响应完成后扣 1 次对话，记审计（不存内容）
    if (completionReceived) {
      deductOneConversation(userId);
      try {
        const db = getDb();
        db.prepare(`
          INSERT INTO proxy_audit (user_id, session_id, model, timestamp)
          VALUES (?, ?, ?, datetime('now'))
        `).run(userId, session_id ?? null, model);
      } catch { /* 表不存在时跳过 */ }
      log.info(`Proxy: user=${userId} model=${model} session=${session_id ?? 'none'}`);
    }
  } catch (err) {
    log.error('Proxy request failed', err);
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    } else {
      try {
        res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
        res.end();
      } catch { /* already closed */ }
    }
  }
});

export default router;
