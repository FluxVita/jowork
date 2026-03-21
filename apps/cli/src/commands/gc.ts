import type { Command } from 'commander';
import { existsSync, statSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath } from '../utils/paths.js';
import { readConfig } from '../utils/config.js';
import { logInfo } from '../utils/logger.js';

export function gcCommand(program: Command): void {
  program
    .command('gc')
    .description('Garbage collect: remove old data, vacuum database')
    .option('--retention-days <days>', 'Override retention days (0 = keep all)')
    .option('--dry-run', 'Show what would be deleted without deleting')
    .action(async (opts) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }

      const config = readConfig();
      const retentionDays = opts.retentionDays
        ? parseInt(opts.retentionDays)
        : (config.retentionDays ?? 0);
      const dryRun = opts.dryRun ?? false;

      const db = new DbManager(dbPath());
      db.ensureTables();
      const sqlite = db.getSqlite();

      // DB size before
      const sizeBefore = statSync(dbPath()).size;
      console.log(`Database size: ${(sizeBefore / 1024 / 1024).toFixed(2)} MB`);

      let deletedBodies = 0;
      let deletedObjects = 0;

      // 1. Retention: delete old object bodies
      if (retentionDays > 0) {
        const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

        if (dryRun) {
          const count = (sqlite.prepare(
            `SELECT COUNT(*) as c FROM object_bodies ob
             JOIN objects o ON o.id = ob.object_id
             WHERE o.created_at < ?`
          ).get(cutoff) as { c: number }).c;
          console.log(`Would delete ${count} object bodies older than ${retentionDays} days`);
        } else {
          // Delete bodies first (FK constraint)
          const result = sqlite.prepare(
            `DELETE FROM object_bodies WHERE object_id IN (
               SELECT id FROM objects WHERE created_at < ?
             )`
          ).run(cutoff);
          deletedBodies = result.changes;

          // Delete objects that no longer have bodies and aren't referenced by links
          const objResult = sqlite.prepare(
            `DELETE FROM objects WHERE created_at < ?
             AND id NOT IN (SELECT object_id FROM object_bodies)
             AND id NOT IN (SELECT source_object_id FROM object_links)`
          ).run(cutoff);
          deletedObjects = objResult.changes;

          console.log(`Deleted ${deletedBodies} old object bodies, ${deletedObjects} orphan objects`);
        }
      } else {
        console.log('Retention: keep all (set retentionDays in config or use --retention-days)');
      }

      // 2. Vacuum
      if (!dryRun) {
        console.log('Running VACUUM...');
        sqlite.exec('VACUUM');
        const sizeAfter = statSync(dbPath()).size;
        const saved = sizeBefore - sizeAfter;
        console.log(`VACUUM complete: ${(sizeAfter / 1024 / 1024).toFixed(2)} MB (saved ${(saved / 1024).toFixed(0)} KB)`);
        logInfo('gc', 'Garbage collection complete', {
          deletedBodies, deletedObjects,
          sizeBefore, sizeAfter, savedBytes: saved,
        });
      }

      // 3. Size warning
      const maxSize = (config.maxDbSizeMB ?? 1024) * 1024 * 1024;
      const currentSize = statSync(dbPath()).size;
      if (currentSize > maxSize * 0.8) {
        console.log(`\n⚠ Database is ${((currentSize / maxSize) * 100).toFixed(0)}% of max size (${config.maxDbSizeMB ?? 1024} MB)`);
        console.log('  Consider setting retentionDays in ~/.jowork/config.json or running gc --retention-days 30');
      }

      db.close();
    });
}
