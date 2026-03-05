/**
 * Klaude 认证代理
 *
 * 将 Klaude API (8899) 暴露在 Gateway (18800/api/klaude/v1) 后方，
 * 所有请求必须携带有效的飞书认证 JWT，离职账号停用后立即失效。
 *
 * 功能：
 * - JWT 认证 + 飞书验证（requireFeishuAuth）
 * - 实时检查用户是否仍在职（is_active）
 * - 流式转发 SSE 响应（Anthropic streaming）
 * - 解析 token 用量并写入 model_costs 表
 *
 * 部署说明：
 * - 将 Klaude 绑定到 127.0.0.1:8899（仅本机可访问）
 * - 员工连接地址改为：http://gateway:18800/api/klaude/v1
 */

import { Router } from 'express';
import { createServer } from 'node:http';
import { authMiddleware, requireFeishuAuth } from '../middleware.js';
import { getDb } from '../../datamap/db.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('klaude-proxy');
const router = Router();

const KLAUDE_ORIGIN = process.env['KLAUDE_URL'] ?? 'http://127.0.0.1:8899';

// ─── Token 用量记录 ───

function ensureCostTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT DEFAULT 'chat',
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
}

function recordUsage(userId: string, model: string, tokensIn: number, tokensOut: number) {
  if (tokensIn === 0 && tokensOut === 0) return;
  ensureCostTable();
  const db = getDb();
  const date = new Date().toISOString().slice(0, 10);
  // Klaude 是本地 Claude，边际成本约等于 Anthropic API 价格
  const costPer1k = 0.003;
  const costUsd = ((tokensIn + tokensOut) / 1000) * costPer1k;
  db.prepare(`
    INSERT INTO model_costs (user_id, provider, model, task_type, tokens_in, tokens_out, cost_usd, date)
    VALUES (?, 'klaude', ?, 'chat', ?, ?, ?, ?)
  `).run(userId, model || 'unknown', tokensIn, tokensOut, costUsd, date);
  log.info('Token usage recorded', { user_id: userId, model, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: costUsd });
}

/** 从 SSE 流文本中解析 token 用量 */
function parseTokensFromSSE(text: string): { model: string; tokensIn: number; tokensOut: number } {
  let model = 'unknown';
  let tokensIn = 0;
  let tokensOut = 0;

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt.type === 'message_start') {
        model = evt.message?.model ?? model;
        tokensIn = evt.message?.usage?.input_tokens ?? 0;
      } else if (evt.type === 'message_delta') {
        tokensOut = evt.usage?.output_tokens ?? 0;
      }
    } catch { /* skip */ }
  }

  return { model, tokensIn, tokensOut };
}

// ─── 代理所有 /v1/* 请求到 Klaude ───

router.all('/*path', authMiddleware, requireFeishuAuth, async (req, res) => {
  const userId = req.user!.user_id;
  const targetPath = '/v1/' + (req.params['path'] ?? '');
  const targetUrl = `${KLAUDE_ORIGIN}${targetPath}`;

  // 组装转发请求头（不带 host、不带原始 authorization）
  const forwardHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (['host', 'connection', 'authorization'].includes(k.toLowerCase())) continue;
    if (typeof v === 'string') forwardHeaders[k] = v;
  }
  // 附加 Gateway 共享密钥（若配置）
  if (process.env['KLAUDE_GATEWAY_SECRET']) {
    forwardHeaders['x-gateway-secret'] = process.env['KLAUDE_GATEWAY_SECRET'];
  }

  let bodyStr: string | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    bodyStr = JSON.stringify(req.body);
    forwardHeaders['content-type'] = 'application/json';
    forwardHeaders['content-length'] = Buffer.byteLength(bodyStr).toString();
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: forwardHeaders,
      body: bodyStr,
    });

    // 透传响应头
    res.status(upstream.status);
    for (const [k, v] of upstream.headers.entries()) {
      if (['transfer-encoding', 'connection'].includes(k.toLowerCase())) continue;
      res.setHeader(k, v);
    }

    const contentType = upstream.headers.get('content-type') ?? '';
    const isSSE = contentType.includes('text/event-stream');

    if (isSSE) {
      // SSE 流：逐块转发，同时收集完整文本用于 token 统计
      let fullText = '';
      const reader = upstream.body!.getReader();
      const decoder = new TextDecoder();

      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        fullText += chunk;
        res.write(chunk);
      }
      res.end();

      // 记录 token 用量
      const { model, tokensIn, tokensOut } = parseTokensFromSSE(fullText);
      recordUsage(userId, model, tokensIn, tokensOut);
    } else {
      // 非流式：读全再转发（同时记录 token）
      const body = await upstream.text();
      res.send(body);

      try {
        const json = JSON.parse(body);
        const model = json.model ?? 'unknown';
        const tokensIn = json.usage?.input_tokens ?? 0;
        const tokensOut = json.usage?.output_tokens ?? 0;
        recordUsage(userId, model, tokensIn, tokensOut);
      } catch { /* non-JSON response */ }
    }
  } catch (err) {
    log.error('Klaude proxy error', err);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Klaude upstream unavailable', detail: String(err) });
    }
  }
});

export default router;
