// @jowork/core/gateway — Express server factory

import express from 'express';
import { healthRouter } from './routes/health.js';
import { errorHandler } from './middleware/error.js';
import { logger } from '../utils/index.js';
import type { Server } from 'node:http';

export interface GatewayOptions {
  port: number;
  /** Additional route registrations (for apps/jowork or apps/fluxvita to extend) */
  setup?: (app: ReturnType<typeof express>) => void;
}

export function createApp(opts: GatewayOptions): ReturnType<typeof express> {
  const app = express();

  app.use(express.json({ limit: '10mb' }));

  // Built-in routes
  app.use(healthRouter());

  // App-specific routes
  opts.setup?.(app);

  // Error handler must be last
  app.use(errorHandler);

  return app;
}

export function startServer(opts: GatewayOptions): Server {
  const app = createApp(opts);
  const server = app.listen(opts.port, () => {
    logger.info(`Jowork gateway listening`, { port: opts.port });
  });
  return server;
}
