import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath } from '../utils/paths.js';
import { getDeviceId, exportSyncBundle, importSyncBundle, getUnsyncedChanges, markSynced } from '../sync/device-sync.js';

export function deviceSyncCommand(program: Command): void {
  const sync = program.command('device-sync').description('Sync data between devices');

  sync.command('status')
    .description('Show device sync status')
    .action(async () => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }
      const db = new DbManager(dbPath());
      db.ensureTables();
      const sqlite = db.getSqlite();

      const deviceId = getDeviceId();
      const unsynced = getUnsyncedChanges(sqlite);
      const total = (sqlite.prepare('SELECT COUNT(*) as c FROM sync_queue').get() as { c: number }).c;

      console.log(`Device ID: ${deviceId}`);
      console.log(`Sync queue: ${unsynced.length} unsynced / ${total} total`);
      db.close();
    });

  sync.command('export')
    .description('Export unsynced changes to a file')
    .argument('<file>', 'Output file path')
    .action(async (file: string) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }
      const db = new DbManager(dbPath());
      db.ensureTables();
      const sqlite = db.getSqlite();

      const bundle = exportSyncBundle(sqlite);
      writeFileSync(file, bundle);
      const parsed = JSON.parse(bundle) as { changes: Array<{ id: string }> };
      console.log(`Exported ${parsed.changes.length} changes to ${file}`);

      // Mark as synced
      markSynced(sqlite, parsed.changes.map((c) => c.id));
      db.close();
    });

  sync.command('import')
    .description('Import changes from another device')
    .argument('<file>', 'Input file path')
    .action(async (file: string) => {
      if (!existsSync(file)) {
        console.error(`File not found: ${file}`);
        process.exit(1);
      }
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }
      const db = new DbManager(dbPath());
      db.ensureTables();

      const bundleJson = readFileSync(file, 'utf-8');
      const result = importSyncBundle(db.getSqlite(), bundleJson);
      console.log(`Applied ${result.applied}, conflicts ${result.conflicts}, skipped ${result.skipped}`);
      db.close();
    });
}
