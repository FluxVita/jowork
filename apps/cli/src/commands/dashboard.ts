import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { dbPath } from '../utils/paths.js';
import { exec } from 'node:child_process';

export function dashboardCommand(program: Command): void {
  program
    .command('dashboard')
    .description('Open the JoWork companion dashboard in your browser')
    .option('-p, --port <port>', 'Port number (default: 18801)')
    .option('--no-open', 'Do not auto-open browser')
    .action(async (opts) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }

      // Dynamic import to avoid loading dashboard deps for other commands
      const { startDashboard } = await import('../dashboard/server.js');

      const port = opts.port ? parseInt(opts.port, 10) : undefined;
      const dashboard = await startDashboard({ port });

      const url = `http://127.0.0.1:${dashboard.port}`;
      console.log(`JoWork Dashboard running at ${url}`);

      if (opts.open !== false) {
        // Auto-open in browser
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} ${url}`, (err) => {
          if (err) console.log(`  Could not auto-open browser. Visit ${url} manually.`);
        });
      }

      console.log('Press Ctrl+C to stop.');

      // Keep process alive
      process.on('SIGINT', () => {
        console.log('\nShutting down dashboard...');
        dashboard.close();
        process.exit(0);
      });
      process.on('SIGTERM', () => {
        dashboard.close();
        process.exit(0);
      });
    });
}
