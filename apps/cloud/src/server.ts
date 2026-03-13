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
app.use('/engine/*', authMiddleware);
app.use('/scheduler/*', authMiddleware);
app.use('/billing/*', authMiddleware);
app.use('/teams/*', authMiddleware);
app.use('/credentials/*', authMiddleware);
app.use('/sync/*', authMiddleware);
app.use('/api/engine/*', authMiddleware);
app.use('/api/scheduler/*', authMiddleware);
app.use('/api/billing/*', authMiddleware);
app.use('/api/teams/*', authMiddleware);
app.use('/api/credentials/*', authMiddleware);
app.use('/api/sync/*', authMiddleware);

// Engine (Cloud AI)
app.post('/engine/chat', handleChat);
app.post('/api/engine/chat', handleChat);

// Scheduler (Cloud task management)
app.post('/scheduler/tasks', createTask);
app.get('/scheduler/tasks', listTasks);
app.patch('/scheduler/tasks/:id', updateTask);
app.delete('/scheduler/tasks/:id', deleteTask);
app.get('/scheduler/executions/:taskId', getExecutions);
app.post('/api/scheduler/tasks', createTask);
app.get('/api/scheduler/tasks', listTasks);
app.patch('/api/scheduler/tasks/:id', updateTask);
app.delete('/api/scheduler/tasks/:id', deleteTask);
app.get('/api/scheduler/executions/:taskId', getExecutions);

// Billing
app.post('/billing/checkout', createCheckout);
app.get('/billing/portal', createPortal);
app.get('/billing/credits', getCredits);
app.post('/billing/top-up', createTopUp);
app.post('/api/billing/checkout', createCheckout);
app.get('/api/billing/portal', createPortal);
app.get('/api/billing/credits', getCredits);
app.post('/api/billing/top-up', createTopUp);

// Credentials (cloud execution authorization)
app.post('/credentials/authorize', authorizeConnector);
app.delete('/credentials/revoke/:id', revokeConnector);
app.post('/credentials/authorize-all', authorizeAll);
app.get('/credentials/status', getStatus);
app.post('/api/credentials/authorize', authorizeConnector);
app.delete('/api/credentials/revoke/:id', revokeConnector);
app.post('/api/credentials/authorize-all', authorizeAll);
app.get('/api/credentials/status', getStatus);

// Teams
app.get('/teams', listTeams);
app.post('/teams', createTeam);
app.get('/teams/:id', getTeam);
app.post('/teams/:id/invite', createInvite);
app.post('/teams/join/:code', joinTeam);
app.delete('/teams/:id/members/:userId', removeMember);
app.patch('/teams/:id/members/:userId', updateMemberRole);
app.get('/api/teams', listTeams);
app.post('/api/teams', createTeam);
app.get('/api/teams/:id', getTeam);
app.post('/api/teams/:id/invite', createInvite);
app.post('/api/teams/join/:code', joinTeam);
app.delete('/api/teams/:id/members/:userId', removeMember);
app.patch('/api/teams/:id/members/:userId', updateMemberRole);

// Team Context Docs
app.get('/teams/:id/context-docs', listTeamContextDocs);
app.post('/teams/:id/context-docs', createTeamContextDoc);
app.get('/api/teams/:id/context-docs', listTeamContextDocs);
app.post('/api/teams/:id/context-docs', createTeamContextDoc);

// Sync
app.post('/sync/push', handlePush);
app.post('/sync/pull', handlePull);
app.get('/sync/status', handleSyncStatus);
app.post('/api/sync/push', handlePush);
app.post('/api/sync/pull', handlePull);
app.get('/api/sync/status', handleSyncStatus);

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
  const path = c.req.path;
  if (path.startsWith('/api/') || path.startsWith('/auth/') || path.startsWith('/engine/') ||
      path.startsWith('/billing/') || path.startsWith('/teams/') || path.startsWith('/scheduler/') ||
      path.startsWith('/credentials/') || path.startsWith('/sync/') || path.startsWith('/channels/') ||
      path.startsWith('/invite/') || path.startsWith('/ws/')) {
    return next();
  }

  // Try to serve static file
  try {
    const { readFile } = await import('fs/promises');
    const { join } = await import('path');
    const filePath = join(process.cwd(), 'public', path);
    const content = await readFile(filePath);
    const ext = path.split('.').pop() || '';
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
