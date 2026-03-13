import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthCheck } from './health';
import { authMiddleware } from './middleware/auth';
import { googleLogin, googleCallback, refreshToken } from './auth/google';
import { createCheckout, createPortal, createTopUp } from './billing/stripe';
import { getCredits } from './billing/credits';
import { handleWebhook } from './billing/webhook';
import { handleFeishuWebhook } from './channels/feishu-bot';
import { listTeams, createTeam, getTeam, createInvite, joinTeam } from './team/teams';
import { removeMember, updateMemberRole } from './team/members';
import { getInviteDetails } from './team/invites';
import { authorizeConnector, revokeConnector, authorizeAll, getStatus } from './credentials/authorize';
import { handleChat } from './engine/chat';
import { createTask, listTasks, updateTask, deleteTask, getExecutions } from './scheduler/routes';
import { handlePush } from './sync/push';
import { handlePull } from './sync/pull';
import { handleStatus as handleSyncStatus } from './sync/status';

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

// Auth (no auth required)
app.get('/auth/google', googleLogin);
app.get('/auth/google/callback', googleCallback);
app.post('/auth/refresh', refreshToken);
app.get('/api/auth/google', googleLogin);
app.get('/api/auth/google/callback', googleCallback);
app.post('/api/auth/refresh', refreshToken);

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

// Sync
app.post('/sync/push', handlePush);
app.post('/sync/pull', handlePull);
app.get('/sync/status', handleSyncStatus);
app.post('/api/sync/push', handlePush);
app.post('/api/sync/pull', handlePull);
app.get('/api/sync/status', handleSyncStatus);

// API status
app.get('/api/v1/status', (c) => c.json({ status: 'ok', phase: 7 }));

const port = parseInt(process.env.PORT || '3000', 10);

export { app };

// Start server (skip in test environment)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port });
    console.log(`Cloud server running on port ${port}`);
  });
}
