import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthCheck } from './health';
import { authMiddleware } from './middleware/auth';
import { googleLogin, googleCallback, refreshToken, getGoogleStatus, getOAuthUrl } from './auth/google';
import { localLogin, compatLogin, getCurrentUser, getSetupStatus } from './auth/local';
import { createCheckout, createPortal, createTopUp } from './billing/stripe';
import { getCredits } from './billing/credits';
import { handleWebhook } from './billing/webhook';
import { handleFeishuWebhook } from './channels/feishu-bot';
import { listTeams, createTeam, getTeam, createInvite, joinTeam } from './team/teams';
import { removeMember, updateMemberRole } from './team/members';
import { getInviteDetails } from './team/invites';
import { listTeamContextDocs, createTeamContextDoc } from './team/context-docs';
import { authorizeConnector, revokeConnector, authorizeAll, getStatus } from './credentials/authorize';
import { handleChat } from './engine/chat';
import { createTask, listTasks, updateTask, deleteTask, getExecutions } from './scheduler/routes';
import { handlePush } from './sync/push';
import { handlePull } from './sync/pull';
import { handleStatus as handleSyncStatus } from './sync/status';
import {
  getEngines, setEngine, listSessions, getSession, deleteSession,
  clearSessions, agentChat, agentStop, listAgentTasks,
  getPreferences, setPreferences, searchSessions,
} from './compat/agent';
import { getMyServices } from './compat/legacy';

const app = new Hono();

// --- Helper: register a route at both /{path} and /api/{path} ---
type Method = 'get' | 'post' | 'patch' | 'delete';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dual(method: Method, path: string, handler: any): void {
  (app[method] as any)(path, handler);
  (app[method] as any)(`/api${path}`, handler);
}

// Global error handler — catches JSON parse errors (→400) and unhandled exceptions (→500)
app.onError((err, c) => {
  if (err instanceof SyntaxError && err.message.includes('JSON')) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  console.error('[Server Error]', err);
  return c.json({ error: 'Internal server error' }, 500);
});

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health (no auth)
app.get('/health', healthCheck);
app.get('/api/health', healthCheck);
app.get('/api/system/setup-status', getSetupStatus);

// Auth (no auth required)
app.get('/auth/google', googleLogin);
app.get('/auth/google/callback', googleCallback);
app.post('/auth/refresh', refreshToken);
app.get('/api/auth/google', googleLogin);
app.get('/api/auth/google/callback', googleCallback);
app.get('/api/auth/google/status', getGoogleStatus);
app.get('/api/auth/oauth/url', getOAuthUrl);
app.post('/api/auth/refresh', refreshToken);
app.post('/api/auth/local', localLogin);
app.post('/api/auth/login', compatLogin);
app.get('/api/auth/me', getCurrentUser);

// Stripe webhook (no auth — verified by signature)
app.post('/billing/webhook', handleWebhook);

// Feishu webhook (no auth — verified by token)
app.post('/channels/feishu/webhook', handleFeishuWebhook);

// Public invite lookup (outside /teams/* to avoid auth middleware)
app.get('/invite/:code', getInviteDetails);

// --- Protected routes (require JWT) ---
app.use('/api/*', authMiddleware);
for (const prefix of ['/engine', '/scheduler', '/billing', '/teams', '/credentials', '/sync']) {
  app.use(`${prefix}/*`, authMiddleware);
}

// Engine (Cloud AI)
dual('post', '/engine/chat', handleChat);

// Scheduler (Cloud task management)
dual('post', '/scheduler/tasks', createTask);
dual('get', '/scheduler/tasks', listTasks);
dual('patch', '/scheduler/tasks/:id', updateTask);
dual('delete', '/scheduler/tasks/:id', deleteTask);
dual('get', '/scheduler/executions/:taskId', getExecutions);

// Billing
dual('post', '/billing/checkout', createCheckout);
dual('get', '/billing/portal', createPortal);
dual('get', '/billing/credits', getCredits);
dual('post', '/billing/top-up', createTopUp);

// Credentials (cloud execution authorization)
dual('post', '/credentials/authorize', authorizeConnector);
dual('delete', '/credentials/revoke/:id', revokeConnector);
dual('post', '/credentials/authorize-all', authorizeAll);
dual('get', '/credentials/status', getStatus);

// Teams
dual('get', '/teams', listTeams);
dual('post', '/teams', createTeam);
dual('get', '/teams/:id', getTeam);
dual('post', '/teams/:id/invite', createInvite);
dual('post', '/teams/join/:code', joinTeam);
dual('delete', '/teams/:id/members/:userId', removeMember);
dual('patch', '/teams/:id/members/:userId', updateMemberRole);

// Team Context Docs
dual('get', '/teams/:id/context-docs', listTeamContextDocs);
dual('post', '/teams/:id/context-docs', createTeamContextDoc);

// Sync
dual('post', '/sync/push', handlePush);
dual('post', '/sync/pull', handlePull);
dual('get', '/sync/status', handleSyncStatus);

// V1-compat agent routes (used by legacy shell.html/chat.html frontend)
app.get('/api/agent/engines', getEngines);
app.post('/api/agent/engine', setEngine);
app.get('/api/agent/sessions', listSessions);
app.get('/api/agent/sessions/search', searchSessions);
app.get('/api/agent/sessions/:id', getSession);
app.delete('/api/agent/sessions/:id', deleteSession);
app.post('/api/agent/sessions/clear', clearSessions);
app.post('/api/agent/chat', agentChat);
app.post('/api/agent/stop', agentStop);
app.get('/api/agent/tasks', listAgentTasks);
app.get('/api/agent/preferences', getPreferences);
app.post('/api/agent/preferences', setPreferences);
app.get('/api/preferences', getPreferences);
app.post('/api/preferences', setPreferences);
app.put('/api/preferences', setPreferences);
app.get('/api/services/mine', getMyServices);

// API status
app.get('/api/v1/status', (c) => c.json({ status: 'ok', phase: 7 }));

// Static files — v1 frontend (shell.html, chat.html, etc.)
// Must be after API routes so API paths take priority
app.get('/', async (c) => {
  const { readFile } = await import('fs/promises');
  const { join } = await import('path');
  const filePath = join(process.cwd(), 'public', 'index.html');
  const content = await readFile(filePath);
  c.header('Content-Type', 'text/html; charset=UTF-8');
  return c.body(content);
});
app.get('/*', async (c, next) => {
  // Only serve static for non-API paths
  const reqPath = c.req.path;
  if (reqPath.startsWith('/api/') || reqPath.startsWith('/auth/') || reqPath.startsWith('/engine/') ||
      reqPath.startsWith('/billing/') || reqPath.startsWith('/teams/') || reqPath.startsWith('/scheduler/') ||
      reqPath.startsWith('/credentials/') || reqPath.startsWith('/sync/') || reqPath.startsWith('/channels/') ||
      reqPath.startsWith('/invite/') || reqPath.startsWith('/ws/')) {
    return next();
  }

  // Try to serve static file (with path traversal protection)
  try {
    const { readFile } = await import('fs/promises');
    const { join, resolve, normalize } = await import('path');
    const publicDir = resolve(process.cwd(), 'public');
    const filePath = resolve(publicDir, normalize(reqPath).replace(/^\/+/, ''));

    // Block path traversal: resolved path must stay within publicDir
    if (!filePath.startsWith(publicDir + '/') && filePath !== publicDir) {
      return c.json({ error: 'Forbidden' }, 403);
    }

    const content = await readFile(filePath);
    const ext = reqPath.split('.').pop() || '';
    const mimeTypes: Record<string, string> = {
      html: 'text/html', js: 'application/javascript', css: 'text/css',
      png: 'image/png', jpg: 'image/jpeg', svg: 'image/svg+xml',
      json: 'application/json', ico: 'image/x-icon', woff2: 'font/woff2',
    };
    c.header('Content-Type', mimeTypes[ext] || 'application/octet-stream');
    return c.body(content);
  } catch {
    return next();
  }
});

const port = parseInt(process.env.PORT || '3000', 10);

export { app };

// Start server (skip in test environment)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port, hostname: '0.0.0.0' });
    console.log(`Cloud server running on 0.0.0.0:${port}`);
  });
}
