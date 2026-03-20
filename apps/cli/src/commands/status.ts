import type { Command } from 'commander';
import { existsSync, statSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath, joworkDir } from '../utils/paths.js';
import { listCredentials } from '../connectors/credential-store.js';

export function statusCommand(program: Command): void {
  program
    .command('status')
    .description('Show JoWork system status')
    .action(async () => {
      if (!existsSync(dbPath())) {
        console.log('JoWork is not initialized. Run `jowork init` first.');
        return;
      }

      const db = new DbManager(dbPath());
      const sqlite = db.getSqlite();

      console.log('JoWork Status');
      console.log('\u2500'.repeat(40));
      console.log(`  Data dir:    ${joworkDir()}`);

      // DB size
      const stats = statSync(dbPath());
      const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
      console.log(`  Database:    ${sizeMB} MB`);
      console.log('');

      // Table counts
      console.log('Data:');
      const tables = ['objects', 'memories', 'connector_configs', 'object_links'];
      for (const table of tables) {
        try {
          const row = sqlite.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as { count: number };
          console.log(`  ${table.padEnd(20)} ${row.count} rows`);
        } catch {
          console.log(`  ${table.padEnd(20)} (not created)`);
        }
      }

      // Connected sources
      console.log('');
      console.log('Connectors:');
      const creds = listCredentials();
      if (creds.length === 0) {
        console.log('  (none connected)');
      } else {
        for (const name of creds) {
          console.log(`  \u2713 ${name}`);
        }
      }

      // Last sync
      try {
        const cursor = sqlite.prepare(`SELECT connector_id, last_synced_at FROM sync_cursors ORDER BY last_synced_at DESC LIMIT 1`).get() as { connector_id: string; last_synced_at: number } | undefined;
        if (cursor) {
          const lastSync = new Date(cursor.last_synced_at).toLocaleString();
          console.log(`\nLast sync: ${cursor.connector_id} at ${lastSync}`);
        }
      } catch { /* no sync_cursors yet */ }

      db.close();
    });
}
