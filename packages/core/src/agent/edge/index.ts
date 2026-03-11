export type { EdgeBackend, ModelEvent, EdgeMessage, SidecarConfig, SidecarEvent } from './types.js';
export { ServerBackend } from './server-backend.js';
export { LocalBackend } from './local-backend.js';
export { LOCAL_TOOLS, getLocalToolDefs, executeLocalTool } from './local-tools.js';
export { edgeAgentLoop } from './edge-loop.js';
export { initLocalMcp, shutdownLocalMcp, isMcpTool } from './mcp-local.js';
