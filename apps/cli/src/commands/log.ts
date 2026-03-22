import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileRepoDir } from '../utils/paths.js';
import { GitManager } from '../sync/git-manager.js';

export function logCommand(program: Command): void {
  program
    .command('log')
    .description('Show data sync history')
    .option('-n, --limit <n>', 'Number of entries', '20')
    .action(async (opts) => {
      const repoDir = fileRepoDir();
      if (!existsSync(join(repoDir, '.git'))) {
        console.log('No sync history yet. Run `jowork sync` first.');
        return;
      }

      const gm = new GitManager(repoDir);
      const entries = await gm.getLog(parseInt(opts.limit));

      if (entries.length === 0) {
        console.log('No sync history.');
        return;
      }

      for (const entry of entries) {
        const date = new Date(entry.date).toLocaleString();
        console.log(`  ${entry.hash}  ${date}  ${entry.message}`);
      }
    });
}
