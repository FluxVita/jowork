import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createJoWorkMcpServer } from '../mcp/server.js';
import { dbPath } from '../utils/paths.js';

export function serveCommand(program: Command): void {
  program
    .command('serve')
    .description('Start MCP server (stdio mode for agents, or --daemon for background)')
    .option('--daemon', 'Run as background daemon with cron sync')
    .action(async (opts) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }

      if (opts.daemon) {
        console.log('Daemon mode not yet implemented. Use stdio mode (default) for now.');
        return;
      }

      // stdio mode — MCP server for agents
      const server = createJoWorkMcpServer({ dbPath: dbPath() });
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });
}
