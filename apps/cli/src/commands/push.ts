import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileRepoDir } from '../utils/paths.js';
import { pushChanges } from '../sync/push-back.js';

export function pushCommand(program: Command): void {
  program
    .command('push')
    .description('Push local file edits back to data sources (GitHub, GitLab, Linear)')
    .option('--dry-run', 'Show what would be pushed without making API calls')
    .action(async (opts) => {
      const repoDir = fileRepoDir();
      if (!existsSync(join(repoDir, '.git'))) {
        console.error(
          'No data repo found. Run `jowork sync` first to create it.',
        );
        process.exit(1);
      }

      console.log('Detecting local changes...');

      if (opts.dryRun) {
        // Import GitManager to show status without pushing
        const { GitManager } = await import('../sync/git-manager.js');
        const gm = new GitManager(repoDir);
        const status = await gm.getStatus();
        const modified = status.modified;
        if (modified.length === 0) {
          console.log('No modified files detected.');
          return;
        }
        console.log(`\nWould push ${modified.length} modified file(s):`);
        for (const f of modified) {
          console.log(`  ${f}`);
        }
        return;
      }

      const results = await pushChanges(repoDir);

      if (results.length === 0) {
        console.log('No pushable changes detected.');
        return;
      }

      for (const r of results) {
        const icon = r.success ? '\u2713' : '\u2717';
        console.log(`  ${icon} [${r.source}] ${r.file}: ${r.message}`);
      }

      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;
      console.log(`\n${succeeded} pushed, ${failed} failed`);
    });
}
