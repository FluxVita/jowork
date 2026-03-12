import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { healthCheck } from './health';

const app = new Hono();

// Middleware
app.use('*', logger());
app.use('*', cors());

// Health
app.get('/health', healthCheck);

// Placeholder routes for Phase 6+
app.get('/api/v1/status', (c) => c.json({ status: 'ok', phase: 'skeleton' }));

const port = parseInt(process.env.PORT || '3000', 10);

export { app };

// Start server
import { serve } from '@hono/node-server';
serve({ fetch: app.fetch, port });
console.log(`Cloud server running on port ${port}`);
