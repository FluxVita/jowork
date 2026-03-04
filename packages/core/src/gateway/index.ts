// @jowork/core/gateway — public API

export { createApp, startServer } from './server.js';
export type { GatewayOptions } from './server.js';
export { authenticate, requireRole } from './middleware/auth.js';
export { errorHandler } from './middleware/error.js';
