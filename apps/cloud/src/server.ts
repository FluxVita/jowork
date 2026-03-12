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
import { createTeam, getTeam, createInvite, joinTeam } from './team/teams';
import { removeMember, updateMemberRole } from './team/members';
import { getInviteDetails } from './team/invites';
import { authorizeConnector, revokeConnector, authorizeAll, getStatus } from './credentials/authorize';

const app = new Hono();

// Global middleware
app.use('*', logger());
app.use('*', cors());

// Health (no auth)
app.get('/health', healthCheck);

// Auth (no auth required)
app.get('/auth/google', googleLogin);
app.get('/auth/google/callback', googleCallback);
app.post('/auth/refresh', refreshToken);

// Stripe webhook (no auth — verified by signature)
app.post('/billing/webhook', handleWebhook);

// Feishu webhook (no auth — verified by token)
app.post('/channels/feishu/webhook', handleFeishuWebhook);

// Public invite lookup
app.get('/teams/invite/:code', getInviteDetails);

// --- Protected routes (require JWT) ---
app.use('/api/*', authMiddleware);
app.use('/billing/*', authMiddleware);
app.use('/teams/*', authMiddleware);
app.use('/credentials/*', authMiddleware);

// Billing
app.post('/billing/checkout', createCheckout);
app.get('/billing/portal', createPortal);
app.get('/billing/credits', getCredits);
app.post('/billing/top-up', createTopUp);

// Credentials (cloud execution authorization)
app.post('/credentials/authorize', authorizeConnector);
app.delete('/credentials/revoke/:id', revokeConnector);
app.post('/credentials/authorize-all', authorizeAll);
app.get('/credentials/status', getStatus);

// Teams
app.post('/teams', createTeam);
app.get('/teams/:id', getTeam);
app.post('/teams/:id/invite', createInvite);
app.post('/teams/join/:code', joinTeam);
app.delete('/teams/:id/members/:userId', removeMember);
app.patch('/teams/:id/members/:userId', updateMemberRole);

// API status
app.get('/api/v1/status', (c) => c.json({ status: 'ok', phase: 6 }));

const port = parseInt(process.env.PORT || '3000', 10);

export { app };

// Start server (skip in test environment)
if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
  import('@hono/node-server').then(({ serve }) => {
    serve({ fetch: app.fetch, port });
    console.log(`Cloud server running on port ${port}`);
  });
}
