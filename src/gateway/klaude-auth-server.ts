/**
 * Klaude 认证服务器
 *
 * 独立监听在 KLAUDE_PROXY_PORT（默认 8899），对外提供与 Klaude 完全相同的 API 接口。
 * 员工的 Klaude 客户端地址不需要改，只需要带上 JWT token（Authorization: Bearer xxx）。
 *
 * 架构：
 *   员工 bin → 0.0.0.0:8899（本服务，有认证）
 *                ↓ 验证通过
 *             127.0.0.1:8900（Klaude 真实服务，仅本机可达）
 *
 * 启用方式（.env）：
 *   KLAUDE_PROXY_ENABLED=true
 *   KLAUDE_PROXY_PORT=8899       # 对外监听端口（员工使用的端口）
 *   KLAUDE_URL=http://127.0.0.1:8900   # Klaude 真实地址（移到 8900 后）
 */

import http from 'node:http';
import { verifyToken } from '../auth/jwt.js';
import { getUserById } from '../auth/users.js';
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('klaude-auth');

const KLAUDE_REAL_URL = process.env['KLAUDE_URL'] ?? 'http://127.0.0.1:8900';

// ─── Token 用量记录 ───

function recordUsage(userId: string, model: string, tokensIn: number, tokensOut: number) {
  if (tokensIn === 0 && tokensOut === 0) return;
  try {
    const db = getDb();
    const date = new Date().toISOString().slice(0, 10);
    const costUsd = ((tokensIn + tokensOut) / 1000) * 0.003;
    db.prepare(`
      INSERT INTO model_costs (user_id, provider, model, task_type, tokens_in, tokens_out, cost_usd, date)
      VALUES (?, 'klaude', ?, 'chat', ?, ?, ?, ?)
    `).run(userId, model || 'unknown', tokensIn, tokensOut, costUsd, date);
    log.info('Usage recorded', { user_id: userId, model, tokens_in: tokensIn, tokens_out: tokensOut });
  } catch (e) {
    log.error('Failed to record usage', e);
  }
}

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

// ─── 认证检查 ───

function authenticate(req: http.IncomingMessage): { ok: true; userId: string } | { ok: false; status: number; message: string } {
  const auth = req.headers['authorization'];
  if (!auth?.startsWith('Bearer ')) {
    return { ok: false, status: 401, message: 'Missing Authorization header. Please include your FluxVita JWT token.' };
  }

  const token = auth.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return { ok: false, status: 401, message: 'Invalid or expired token.' };
  }

  if (!payload.feishu_verified) {
    return { ok: false, status: 403, message: 'Feishu authentication required. Please login via FluxVita.' };
  }

  const user = getUserById(payload.user_id);
  if (!user || !user.is_active) {
    return { ok: false, status: 403, message: 'Account deactivated or not found.' };
  }

  return { ok: true, userId: user.user_id };
}

// ─── 主服务器 ───

export function startKlaudeAuthServer(port = 8899): http.Server {
  const server = http.createServer(async (req, res) => {
    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key, anthropic-version',
      });
      res.end();
      return;
    }

    // 认证
    const authResult = authenticate(req);
    if (!authResult.ok) {
      res.writeHead(authResult.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: authResult.message }));
      return;
    }
    const { userId } = authResult;

    // 读取请求 body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const bodyBuf = Buffer.concat(chunks);

    // 转发请求到 Klaude 真实地址
    const targetUrl = `${KLAUDE_REAL_URL}${req.url ?? '/'}`;
    const forwardHeaders: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (['host', 'connection', 'authorization'].includes(k.toLowerCase())) continue;
      if (typeof v === 'string') forwardHeaders[k] = v;
    }
    if (process.env['KLAUDE_GATEWAY_SECRET']) {
      forwardHeaders['x-gateway-secret'] = process.env['KLAUDE_GATEWAY_SECRET'];
    }
    if (bodyBuf.length > 0) {
      forwardHeaders['content-length'] = bodyBuf.length.toString();
    }

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers: forwardHeaders,
        body: bodyBuf.length > 0 ? bodyBuf : undefined,
      });

      // 透传响应头
      const respHeaders: Record<string, string> = {};
      upstream.headers.forEach((v, k) => {
        if (['transfer-encoding', 'connection'].includes(k.toLowerCase())) return;
        respHeaders[k] = v;
      });
      respHeaders['access-control-allow-origin'] = '*';
      res.writeHead(upstream.status, respHeaders);

      const contentType = upstream.headers.get('content-type') ?? '';
      const isSSE = contentType.includes('text/event-stream');

      if (isSSE) {
        // 流式：逐块转发 + 收集完整内容用于 token 统计
        let fullText = '';
        const reader = upstream.body!.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          fullText += chunk;
          res.write(chunk);
        }
        res.end();
        const { model, tokensIn, tokensOut } = parseTokensFromSSE(fullText);
        recordUsage(userId, model, tokensIn, tokensOut);
      } else {
        const body = await upstream.text();
        res.end(body);
        try {
          const json = JSON.parse(body);
          recordUsage(userId, json.model ?? 'unknown', json.usage?.input_tokens ?? 0, json.usage?.output_tokens ?? 0);
        } catch { /* non-JSON */ }
      }
    } catch (err) {
      log.error('Upstream error', err);
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Klaude upstream unavailable', detail: String(err) }));
      }
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      log.warn(`Klaude auth proxy: port ${port} already in use, skipping`);
    } else {
      log.error('Klaude auth proxy error', err);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    log.info(`Klaude auth proxy listening on 0.0.0.0:${port} → ${KLAUDE_REAL_URL}`);
  });

  return server;
}
