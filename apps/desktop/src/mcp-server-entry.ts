#!/usr/bin/env node
/**
 * JoWork MCP Server — standalone entry point.
 * Spawned by Claude Code / Cursor via .claude.json config.
 * Communicates over stdio (stdin/stdout).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createJoWorkMcpServer } from './main/mcp/server';

const dbPath = process.env['JOWORK_DB_PATH'];
if (!dbPath) {
  console.error('JOWORK_DB_PATH environment variable is required');
  process.exit(1);
}

const server = createJoWorkMcpServer({ dbPath });
const transport = new StdioServerTransport();

server.connect(transport).catch((err) => {
  console.error('Failed to start JoWork MCP Server:', err);
  process.exit(1);
});
