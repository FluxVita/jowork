import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath } from '../utils/paths.js';
import { loadCredential, listCredentials } from '../connectors/credential-store.js';
import { logError } from '../utils/logger.js';
import { linkAllUnprocessed } from '../sync/linker.js';
import { syncFeishu } from '../sync/feishu.js';

export function syncCommand(program: Command): void {
  program
    .command('sync')
    .description('Sync data from connected sources')
    .option('--source <source>', 'Sync specific source only')
    .action(async (opts) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }

      const db = new DbManager(dbPath());
      db.ensureTables();
      const sources = opts.source ? [opts.source] : listCredentials();

      if (sources.length === 0) {
        console.log('No data sources connected. Run `jowork connect <source>` first.');
        db.close();
        return;
      }

      for (const source of sources) {
        const cred = loadCredential(source);
        if (!cred) {
          console.log(`\u2298 ${source}: no credentials found, skipping`);
          continue;
        }

        console.log(`Syncing ${source}...`);
        try {
          switch (source) {
            case 'feishu': {
              const logger = {
                info: (msg: string) => console.log(`  ${msg}`),
                warn: (msg: string) => console.log(`  \u26A0 ${msg}`),
                error: (msg: string) => console.error(`  \u2717 ${msg}`),
              };
              const result = await syncFeishu(db.getSqlite(), cred.data, logger);
              console.log(`  \u2713 Synced ${result.totalMessages} messages (${result.newMessages} new) from ${result.chats} chats`);
              break;
            }
            case 'github':
              console.log(`  GitHub sync not yet implemented (Phase 4)`);
              break;
            default:
              console.log(`  Unknown source: ${source}`);
          }
        } catch (err) {
          logError('sync', `Failed to sync ${source}`, { error: String(err) });
          console.error(`  \u2717 ${source} sync failed: ${err}`);
        }
      }

      // Run entity extraction on newly synced objects
      console.log('Running entity extraction...');
      const { processed, linksCreated } = linkAllUnprocessed(db.getSqlite());
      console.log(`  \u2713 Extracted ${linksCreated} links from ${processed} objects`);

      db.close();
    });
}
