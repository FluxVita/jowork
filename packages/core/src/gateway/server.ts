import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import { existsSync, readFileSync } from 'node:fs';
import { statSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseUrl } from 'node:url';
import { config } from '../config.js';
import { initSchema } from '../datamap/db.js';
import { verifyToken } from '../auth/jwt.js';
import { getUserById } from '../auth/users.js';
import { routeModel } from '../models/router.js';
import { searchObjects } from '../datamap/objects.js';
import { filterByAccess } from '../policy/engine.js';
import { getConnectorBySource, getConnectors } from '../connectors/registry.js';
import { logAudit } from '../audit/logger.js';
import { createLogger } from '../utils/logger.js';
import type { User } from '../types.js';
import { createSession, detachSession, destroySession, reattachSession, resizeSession, getSession, setWsExitHandler } from './terminal.js';
import authRoutes from './routes/auth.js';
import datamapRoutes from './routes/datamap.js';
import policyRoutes from './routes/policy.js';
import quotaRoutes from './routes/quota.js';
import auditRoutes from './routes/audit.js';
import connectorRoutes from './routes/connectors.js';
import webhookRoutes from './routes/webhooks.js';
import modelRoutes from './routes/models.js';
import schedulerRoutes from './routes/scheduler.js';
import settingsRoutes from './routes/settings.js';
import dashboardRoutes from './routes/dashboard.js';
import onboardingRoutes from './routes/onboarding.js';
import feedbackRoutes from './routes/feedback.js';
import agentRoutes from './routes/agent.js';
import servicesRoutes from './routes/services.js';
import memoryRoutes from './routes/memory.js';
import preferencesRoutes from './routes/preferences.js';
import aiServicesRoutes from './routes/ai-services.js';
import binServerRoutes from './routes/bin-server.js';
import groupBindingsRoutes from './routes/group-bindings.js';
import groupsRoutes from './routes/groups.js';
import klaudeProxyRoutes from './routes/klaude-proxy.js';
import filesRoutes from './routes/files.js';
import logsRoutes from './routes/logs.js';
import adminLogsRoutes from './routes/admin-logs.js';
import { requestLogger } from './middleware.js';
import contextRoutes from './routes/context.js';
import systemRoutes from './routes/system.js';
import billingRoutes from './routes/billing.js';
import proxyRoutes from './routes/proxy.js';
import licenseRoutes from './routes/license.js';
import hooksRoutes from './routes/hooks.js';
import edgeRoutes from './routes/edge.js';
import { seedDefaultServices } from '../services/seed.js';
import { startAdvertising } from '../discovery/mdns.js';
import { getOrgSetting } from '../auth/settings.js';

const log = createLogger('gateway');

export interface GatewayOptions {
  /** 静态文件目录。默认：process.cwd()/public */
  publicDir?: string;
  /** 回退静态文件目录（当 publicDir 中找不到文件时使用）。可选。 */
  fallbackPublicDir?: string;
}

export function startGateway(opts: GatewayOptions = {}) {
  // 初始化数据库
  initSchema();
  seedDefaultServices();

  const app = express();

  // Stripe webhook 需要 raw body 验证签名，必须在 express.json() 之前注册
  app.use('/api/billing/webhook', express.raw({ type: 'application/json' }), (req, _res, next) => {
    (req as typeof req & { rawBody?: Buffer }).rawBody = req.body as Buffer;
    next();
  });

  // body-parser@2.2.2 (Express 5) 对 charset 大小写敏感，用 type 函数统一匹配
  app.use(express.json({ type: (req) => {
    const ct = (req.headers['content-type'] ?? '').toLowerCase();
    return ct.startsWith('application/json');
  }}));

  // 请求耗时监控（慢请求/5xx 自动写持久化日志）
  app.use(requestLogger);

  // CORS — 白名单模式
  const CORS_ORIGINS = (process.env['CORS_ORIGINS'] ?? '').split(',').filter(Boolean);
  const IS_DEV = process.env['NODE_ENV'] !== 'production';
  const CORS_ALLOW_DEV_ALL = process.env['CORS_ALLOW_DEV_ALL'] === 'true';
  const ALLOW_WS_QUERY_TOKEN = process.env['ALLOW_WS_QUERY_TOKEN'] === 'true';

  app.use((_req, res, next) => {
    const origin = _req.headers.origin ?? '';
    const localDevOrigin =
      origin.startsWith('http://localhost') ||
      origin.startsWith('http://127.0.0.1') ||
      origin === 'tauri://localhost';

    let allowOrigin = false;
    if (origin && CORS_ORIGINS.includes(origin)) allowOrigin = true;
    if (IS_DEV && localDevOrigin) allowOrigin = true;
    if (IS_DEV && CORS_ALLOW_DEV_ALL && origin) allowOrigin = true;

    if (allowOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
    // 安全头
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // 健康检查（无需认证）
  app.get('/health', (_req, res) => {
    let dbSize = 0;
    try { dbSize = statSync(config.db_path).size; } catch { dbSize = 0; }
    res.json({
      status: 'ok',
      service: 'jowork-gateway',
      version: '0.1.0',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      connectors: getConnectors().length,
      db_size: dbSize,
    });
  });

  // 深度健康检查（无需认证）：验证 Klaude、模型可用性
  // 用于部署后冒烟测试和监控系统
  app.get('/health/deep', async (_req, res) => {
    const results: Record<string, unknown> = { timestamp: new Date().toISOString() };

    // Klaude 检查
    const klaudePort = process.env['KLAUDE_PORT'] ?? '8899';
    try {
      const resp = await fetch(`http://127.0.0.1:${klaudePort}/ping`, { signal: AbortSignal.timeout(3000) });
      results['klaude'] = { ok: resp.ok, status: resp.status };
    } catch (e) {
      results['klaude'] = { ok: false, error: String(e) };
    }

    // 模型可用性（轻量 ping：发一条最小请求看模型是否响应）
    try {
      const modelResult = await routeModel({
        messages: [{ role: 'user', content: 'ping' }],
        maxTokens: 5,
        taskType: 'chat',
        userId: 'system_health_check',
      });
      results['model'] = { ok: !!modelResult.content, provider: modelResult.provider, model: modelResult.model };
    } catch (e) {
      results['model'] = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    // Credits（通过 Bearer token 可选传入 userId）
    const authHeader = _req.headers['authorization'];
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const token = authHeader.slice(7);
        const payload = verifyToken(token);
        if (payload) {
          const { getCreditsBalance } = await import('../billing/credits.js');
          const { getUserPlan } = await import('../billing/features.js');
          const balance = getCreditsBalance(payload.user_id);
          const plan = getUserPlan(payload.user_id);
          results['credits'] = { remaining: balance.remaining, total: balance.total, used: balance.used, plan };
        }
      } catch { /* ignore auth errors — credits is optional */ }
    }

    const allOk = (results['klaude'] as Record<string, unknown>)?.['ok'] === true
      && (results['model'] as Record<string, unknown>)?.['ok'] === true;
    res.json({ status: allOk ? 'ok' : 'degraded', ...results });
  });

  app.use('/api', (req, res, next) => {
    if (!req.path.startsWith('/v1/')) {
      res.setHeader('Deprecation', 'true');
      res.setHeader('Sunset', 'Wed, 31 Dec 2026 23:59:59 GMT');
      res.setHeader('Link', '</api/v1>; rel="successor-version"');
    }
    next();
  });

  const apiRouteMounts: Array<[string, import('express').Router]> = [
    ['/auth', authRoutes],
    ['/datamap', datamapRoutes],
    ['/policy', policyRoutes],
    ['/quota', quotaRoutes],
    ['/audit', auditRoutes],
    ['/connectors', connectorRoutes],
    ['/webhook', webhookRoutes],
    ['/models', modelRoutes],
    ['/scheduler', schedulerRoutes],
    ['/settings', settingsRoutes],
    ['/dashboard', dashboardRoutes],
    ['/onboarding', onboardingRoutes],
    ['/feedback', feedbackRoutes],
    ['/agent', agentRoutes],
    ['/services', servicesRoutes],
    ['/memory', memoryRoutes],
    ['/preferences', preferencesRoutes],
    ['/ai-services', aiServicesRoutes],
    ['/ai-services', binServerRoutes],
    ['/group-bindings', groupBindingsRoutes],
    ['/groups', groupsRoutes],
    ['/files', filesRoutes],
    ['/logs', logsRoutes],
    ['/admin/logs', adminLogsRoutes],
    ['/context', contextRoutes],
    ['/system', systemRoutes],
    ['/billing', billingRoutes],
    ['/proxy', proxyRoutes],
    ['/license', licenseRoutes],
    ['/hooks', hooksRoutes],
    ['/edge', edgeRoutes],
  ];

  for (const [path, router] of apiRouteMounts) {
    app.use(`/api${path}`, router);
    app.use(`/api/v1${path}`, router);
  }

  app.use('/api/klaude/v1', klaudeProxyRoutes);
  app.use('/api/v1/klaude/v1', klaudeProxyRoutes);

  // 静态文件（看板 Web UI）
  const resolvedPublicDir = opts.publicDir ?? join(process.cwd(), 'public');
  const staticOpts = {
    setHeaders: (res: import('http').ServerResponse) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  };
  app.use(express.static(resolvedPublicDir, staticOpts));
  // 可选：回退目录（用于多 public 层叠，如 jowork 覆盖 + core 公共文件）
  if (opts.fallbackPublicDir) {
    app.use(express.static(opts.fallbackPublicDir, staticOpts));
  }

  // SPA fallback：非 API 路径返回 shell.html
  app.get('/{*path}', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const shellHtml = join(resolvedPublicDir, 'shell.html');
    res.sendFile(shellHtml);
  });

  // 全局错误处理（4-参数 Express 错误中间件，必须放在所有路由之后）
  // 捕获 PayloadTooLargeError、SyntaxError（malformed JSON）等 body-parser 错误
  app.use((err: Error & { status?: number; type?: string }, _req: import('express').Request, res: import('express').Response, _next: import('express').NextFunction) => {
    const status = (err as { status?: number }).status ?? 500;
    if (status === 413 || err.type === 'entity.too.large') {
      res.status(413).json({ error: '请求体过大，请缩短消息内容后重试' });
      return;
    }
    if (err instanceof SyntaxError && status === 400) {
      res.status(400).json({ error: 'JSON 格式错误' });
      return;
    }
    log.error('Unhandled middleware error', { status, message: err.message });
    res.status(status).json({ error: err.message || '服务器内部错误' });
  });

  // 404（API only）
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  // HTTP / HTTPS Server（有证书文件时自动启用 HTTPS）
  const certPath = resolve(process.cwd(), 'data/tls.cert');
  const keyPath  = resolve(process.cwd(), 'data/tls.key');
  const hasTls   = existsSync(certPath) && existsSync(keyPath);
  const server   = hasTls
    ? createHttpsServer({ cert: readFileSync(certPath), key: readFileSync(keyPath) }, app)
    : createHttpServer(app);

  // WebSocket 实时通信
  const wss = new WebSocketServer({ noServer: true });
  const wssTerm = new WebSocketServer({ noServer: true });

  // 连接的认证用户映射
  const wsClients = new Map<WebSocket, User>();

  // ─── PTY WebSocket 心跳检测（60s 发 ping，未回 pong 则断开）───
  // 防止 TCP 静默断开导致 PTY 会话泄漏
  const termAlive = new WeakMap<WebSocket, boolean>();
  setInterval(() => {
    wssTerm.clients.forEach((ws) => {
      if (termAlive.get(ws) === false) {
        // 上一个心跳周期没有回应，强制断开（触发 ws.on('close') → destroySession）
        log.warn('Terminal WS heartbeat timeout, terminating connection');
        ws.terminate();
        return;
      }
      termAlive.set(ws, false);
      ws.ping();
    });
  }, 60_000);

  // Upgrade 时做 JWT 认证
  server.on('upgrade', (req, socket, head) => {
    const { pathname, query } = parseUrl(req.url ?? '', true);
    if (pathname !== '/ws' && pathname !== '/ws/terminal') {
      socket.destroy();
      return;
    }

    // 默认仅从 WebSocket subprotocol 读取 token，避免 query token 泄露到日志
    const protocolHeader = req.headers['sec-websocket-protocol'];
    const protocolValue = Array.isArray(protocolHeader) ? protocolHeader[0] : protocolHeader;
    let token = protocolValue?.split(',')[0]?.trim();

    // 为兼容旧客户端可显式开启 query token（默认关闭）
    if (!token && ALLOW_WS_QUERY_TOKEN) {
      token = query['token'] as string;
    }
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const payload = verifyToken(token);
    if (!payload) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const user = getUserById(payload.user_id);
    if (!user || !user.is_active) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    if (pathname === '/ws/terminal') {
      wssTerm.handleUpgrade(req, socket, head, (ws) => {
        wssTerm.emit('connection', ws, req, user);
      });
    } else {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wsClients.set(ws, user);
        wss.emit('connection', ws, req);
      });
    }
  });

  // ─── PTY Terminal WebSocket ───
  // 设计：PTY 生命周期与 WebSocket 解耦（VSCode 风格）
  //   - 连接时携带 resumeId → 重连到已有 PTY，回放 ring buffer
  //   - 断开时 detach（PTY 继续运行），而非 destroy
  //   - 用户主动关闭（发 close 消息）才 destroy
  wssTerm.on('connection', (ws: WebSocket, _req: unknown, user: User) => {
    log.info(`Terminal WS connected: ${user.name}`);
    let sessionId: string | null = null;

    // 注册心跳 pong 响应（与上方 setInterval ping 配合）
    termAlive.set(ws, true);
    ws.on('pong', () => { termAlive.set(ws, true); });
    ws.on('error', (err) => {
      log.warn('Terminal WS error', { user: user.name, error: String(err) });
    });

    // 向客户端发送控制消息（\x00 前缀区分 PTY 输出）
    const sendCtrl = (msg: Record<string, unknown>) => {
      if (ws.readyState === ws.OPEN) ws.send('\x00' + JSON.stringify(msg));
    };

    // PTY 输出 → WebSocket
    const sendFn = (chunk: string) => {
      if (ws.readyState === ws.OPEN) ws.send(chunk);
    };

    ws.on('message', (data) => {
      const raw = data.toString();

      // 控制消息（JSON）
      if (raw.startsWith('{')) {
        try {
          const msg = JSON.parse(raw) as {
            type: string;
            resumeId?: string;
            mode?: string;
            tmuxSession?: string;
            cols?: number;
            rows?: number;
            data?: string;
          };

          if (msg.type === 'init') {
            // ① 尝试重连到已有会话（用户刷新页面 / 网络抖动恢复）
            if (msg.resumeId) {
              const result = reattachSession(msg.resumeId, user.user_id, sendFn);
              if (result) {
                sessionId = result.session.id;
                // 回放断开期间的 ring buffer 输出
                if (result.bufferedOutput && ws.readyState === ws.OPEN) {
                  ws.send(result.bufferedOutput);
                }
                // setWsExitHandler 先 dispose 旧监听器再注册新的，防止重连累积泄漏
                setWsExitHandler(sessionId, () => {
                  sendCtrl({ type: 'session_exit' });
                  if (ws.readyState === ws.OPEN) ws.close();
                });
                sendCtrl({ type: 'session_ready', sessionId, resumed: true });
                return;
              }
              // resumeId 对应的会话已不存在，正常新建
            }

            // ② 新建 PTY 会话
            try {
              const session = createSession({
                userId: user.user_id,
                mode: (msg.mode as 'klaude' | 'tmux' | 'shell') ?? 'shell',
                tmuxSession: msg.tmuxSession,
                cols: msg.cols ?? 220,
                rows: msg.rows ?? 50,
                sendFn,
              });
              sessionId = session.id;

              // 新会话也用 setWsExitHandler，保持统一
              setWsExitHandler(sessionId, () => {
                sendCtrl({ type: 'session_exit' });
                if (ws.readyState === ws.OPEN) ws.close();
              });

              sendCtrl({ type: 'session_ready', sessionId, resumed: false });
            } catch (err) {
              ws.send(`\x1b[31m[启动失败: ${String(err)}]\x1b[0m\r\n`);
              ws.close();
            }

          } else if (msg.type === 'resize' && sessionId) {
            resizeSession(sessionId, msg.cols ?? 80, msg.rows ?? 24);

          } else if (msg.type === 'input' && sessionId && msg.data) {
            getSession(sessionId)?.pty.write(msg.data);

          } else if (msg.type === 'close' && sessionId) {
            // 用户主动关闭终端 Tab → 真正销毁 PTY
            destroySession(sessionId);
            sessionId = null;
            ws.close();
          }
        } catch { /* not JSON, treat as raw input */ }
        return;
      }

      // 原始键盘输入 → PTY
      if (sessionId) {
        getSession(sessionId)?.pty.write(raw);
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      const reasonStr = reason?.toString() || '';
      log.info(`Terminal WS closed: ${user.name} code=${code} reason=${reasonStr} session=${sessionId}`);
      // WebSocket 断开 → detach（PTY 继续运行，等待重连）
      // 注意：用户主动 close 已在 msg.type==='close' 里 destroy，此处 sessionId 为 null
      if (sessionId) {
        detachSession(sessionId);
        log.debug(`Terminal WS detached (PTY still running): ${user.name} session=${sessionId}`);
      }
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    const user = wsClients.get(ws);
    log.info(`WebSocket client connected: ${user?.name ?? 'unknown'}`);

    // 发送欢迎消息
    ws.send(JSON.stringify({ type: 'connected', user: { name: user?.name, role: user?.role } }));

    ws.on('message', async (data) => {
      if (!user) return;

      let msg: { type: string; content?: string; session_id?: string };
      try {
        msg = JSON.parse(data.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        return;
      }

      if (msg.type === 'query' && msg.content) {
        // 发送 typing 指示
        ws.send(JSON.stringify({ type: 'typing', session_id: msg.session_id }));

        try {
          // 搜索相关数据
          const results = searchObjects({ query: msg.content, limit: 5 });
          const accessible = filterByAccess(user, results);

          // 拉取上下文
          const contextParts: string[] = [];
          const sources: string[] = [];
          for (const obj of accessible.slice(0, 3)) {
            try {
              const connector = getConnectorBySource(obj.source);
              if (connector) {
                const fetched = await connector.fetch(obj.uri, { user_id: user.user_id, role: user.role });
                contextParts.push(`[${obj.source}] ${obj.title}\n${fetched.content.slice(0, 1500)}`);
                sources.push(`${obj.source}: ${obj.title}`);
              }
            } catch { /* skip */ }
          }

          const systemPrompt = [
            'You are an AI assistant. Answer the user\'s question based on the following data from connected sources.',
            contextParts.length > 0
              ? `\n--- 相关数据 ---\n${contextParts.join('\n\n')}\n--- 数据结束 ---`
              : '',
          ].join('\n');

          const result = await routeModel({
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: msg.content },
            ],
            taskType: 'chat',
            userId: user.user_id,
          });

          ws.send(JSON.stringify({
            type: 'response',
            session_id: msg.session_id,
            content: result.content,
            sources,
            model: `${result.provider}/${result.model}`,
            tokens: result.tokens_in + result.tokens_out,
          }));

          logAudit({
            actor_id: user.user_id,
            actor_role: user.role,
            channel: 'web',
            action: 'search',
            result: 'allowed',
            matched_rule: 'ws_query',
            response_sources: sources,
          });
        } catch (err) {
          ws.send(JSON.stringify({
            type: 'error',
            session_id: msg.session_id,
            message: String(err),
          }));
        }
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    });

    ws.on('close', (code: number, reason: Buffer) => {
      wsClients.delete(ws);
      log.info(`WS client disconnected: ${user?.name} code=${code} reason=${reason?.toString() || ''}`);
    });
  });

  server.listen(config.port, config.host, () => {
    const proto = hasTls ? 'https' : 'http';
    log.info(`Jowork Gateway running on ${proto}://${config.host}:${config.port}`);

    // Host 模式：向局域网广播 mDNS 服务，让团队成员可自动发现
    const mode = getOrgSetting('jowork_mode');
    if (mode === 'host') {
      startAdvertising(config.port);
      log.info('[mdns] Advertising Jowork service on LAN (host mode)');
    }
    log.info('API endpoints:');
    log.info('  GET  /health');
    log.info('  POST /api/auth/login');
    log.info('  POST /api/auth/cli-login');
    log.info('  GET  /api/auth/me');
    log.info('  GET  /api/datamap/search?q=...');
    log.info('  GET  /api/datamap/object/:id');
    log.info('  GET  /api/datamap/stats');
    log.info('  GET  /api/policy/check?object_id=...&action=...');
    log.info('  GET  /api/policy/me');
    log.info('  GET  /api/quota/dashboard');
    log.info('  GET  /api/quota/feishu');
    log.info('  GET  /api/audit/logs');
    log.info('  GET  /api/connectors');
    log.info('  GET  /api/connectors/health');
    log.info('  POST /api/connectors/:id/discover');
    log.info('  POST /api/connectors/:id/fetch');
    log.info('  POST /api/webhook/feishu');
    log.info('  POST /api/webhook/gitlab');
    log.info('  POST /api/models/chat');
    log.info('  GET  /api/models/cost');
    log.info('  GET  /api/scheduler/tasks');
    log.info('  POST /api/scheduler/tasks');
    log.info('  POST /api/agent/chat');
    log.info('  GET  /api/agent/sessions');
    log.info('  GET  /api/agent/sessions/:id');
    log.info('  DELETE /api/agent/sessions/:id');
    log.info('  GET  /api/services/mine');
    log.info('  GET  /api/services');
    log.info('  POST /api/services');
    log.info('  PUT  /api/services/:id');
    log.info('  POST /api/services/:id/grants');
    log.info('  POST /api/services/sync-groups');
  });

  return server;
}
