// Suppress i18next banner — stdout must be pure JSON for MCP protocol
process.env['I18NEXT_DISABLE_BANNER'] = '1';

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createJoWorkMcpServer } from './server.js';
import { dbPath } from '../utils/paths.js';

async function main() {
  const server = createJoWorkMcpServer({ dbPath: dbPath() });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP server fatal: ${err}\n`);
  process.exit(1);
});
