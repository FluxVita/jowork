import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath } from '../utils/paths.js';
import { loadCredential, listCredentials } from '../connectors/credential-store.js';
import { logError } from '../utils/logger.js';
import { linkAllUnprocessed } from '../sync/linker.js';
import { syncFeishu, syncFeishuMeetings, syncFeishuDocs } from '../sync/feishu.js';
import { syncGitHub } from '../sync/github.js';
import { syncGitLab } from '../sync/gitlab.js';
import { syncLinear } from '../sync/linear.js';
import { syncPostHog } from '../sync/posthog.js';

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

              // Also sync meetings/calendar
              try {
                const meetResult = await syncFeishuMeetings(db.getSqlite(), cred.data, logger);
                if (meetResult.meetings > 0) {
                  console.log(`  \u2713 Synced ${meetResult.meetings} calendar events (${meetResult.newObjects} new)`);
                }
              } catch (err) {
                console.log(`  \u26A0 Meeting sync: ${err}`);
              }

              // Also sync documents
              try {
                const docResult = await syncFeishuDocs(db.getSqlite(), cred.data, logger);
                if (docResult.docs > 0) {
                  console.log(`  \u2713 Synced ${docResult.docs} documents (${docResult.newObjects} new)`);
                }
              } catch (err) {
                console.log(`  \u26A0 Document sync: ${err}`);
              }
              break;
            }
            case 'github': {
              const ghLogger = {
                info: (msg: string) => console.log(`  ${msg}`),
                warn: (msg: string) => console.log(`  \u26A0 ${msg}`),
                error: (msg: string) => console.error(`  \u2717 ${msg}`),
              };
              const result = await syncGitHub(db.getSqlite(), cred.data, ghLogger);
              console.log(`  \u2713 Synced ${result.repos} repos: ${result.issues} issues, ${result.prs} PRs (${result.newObjects} new)`);
              break;
            }
            case 'gitlab': {
              const glLogger = {
                info: (msg: string) => console.log(`  ${msg}`),
                warn: (msg: string) => console.log(`  \u26A0 ${msg}`),
                error: (msg: string) => console.error(`  \u2717 ${msg}`),
              };
              const glResult = await syncGitLab(db.getSqlite(), cred.data, glLogger);
              console.log(`  \u2713 Synced ${glResult.projects} projects: ${glResult.issues} issues, ${glResult.mrs} MRs (${glResult.newObjects} new)`);
              break;
            }
            case 'linear': {
              const linLogger = {
                info: (msg: string) => console.log(`  ${msg}`),
                warn: (msg: string) => console.log(`  \u26A0 ${msg}`),
                error: (msg: string) => console.error(`  \u2717 ${msg}`),
              };
              const linResult = await syncLinear(db.getSqlite(), cred.data, linLogger);
              console.log(`  \u2713 Synced ${linResult.issues} Linear issues (${linResult.newObjects} new)`);
              break;
            }
            case 'posthog': {
              const phLogger = {
                info: (msg: string) => console.log(`  ${msg}`),
                warn: (msg: string) => console.log(`  \u26A0 ${msg}`),
                error: (msg: string) => console.error(`  \u2717 ${msg}`),
              };
              const phResult = await syncPostHog(db.getSqlite(), cred.data, phLogger);
              console.log(`  \u2713 Synced ${phResult.insights} insights, ${phResult.events} events (${phResult.newObjects} new)`);
              break;
            }
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
