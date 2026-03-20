import type { Command } from 'commander';
import { existsSync, writeFileSync } from 'node:fs';
import Database from 'better-sqlite3';
import { dbPath } from '../utils/paths.js';

export function exportCommand(program: Command): void {
  program
    .command('export')
    .description('Export database backup')
    .option('--format <format>', 'Export format: sqlite or json', 'sqlite')
    .option('--output <path>', 'Output file path')
    .action(async (opts) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }

      const outputPath = opts.output ?? `jowork-backup-${Date.now()}.${opts.format === 'json' ? 'json' : 'db'}`;

      if (opts.format === 'sqlite') {
        const db = new Database(dbPath());
        await db.backup(outputPath);
        db.close();
        console.log(`\u2713 Database backed up to ${outputPath}`);
      } else if (opts.format === 'json') {
        const db = new Database(dbPath());
        const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name != 'schema_version'").all() as { name: string }[];
        const data: Record<string, unknown[]> = {};
        for (const { name } of tables) {
          data[name] = db.prepare(`SELECT * FROM "${name}"`).all();
        }
        writeFileSync(outputPath, JSON.stringify(data, null, 2));
        db.close();
        console.log(`\u2713 Data exported to ${outputPath} (${tables.length} tables)`);
      } else {
        console.error(`Unknown format: ${opts.format}. Use 'sqlite' or 'json'.`);
      }
    });
}
