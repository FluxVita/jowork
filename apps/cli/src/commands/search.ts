import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath } from '../utils/paths.js';

export function searchCommand(program: Command): void {
  program
    .command('search')
    .description('Search across all synced data')
    .argument('<query>', 'Search keywords')
    .option('--source <source>', 'Filter by source')
    .option('--limit <n>', 'Max results', '20')
    .action(async (query: string, opts) => {
      if (!existsSync(dbPath())) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
      }

      const db = new DbManager(dbPath());
      const sqlite = db.getSqlite();
      const limit = parseInt(opts.limit) || 20;

      const pattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
      let rows: unknown[];
      if (opts.source) {
        rows = sqlite.prepare(`
          SELECT id, title, summary, source, source_type, uri FROM objects
          WHERE (title LIKE ? OR summary LIKE ?) AND source = ?
          ORDER BY last_synced_at DESC LIMIT ?
        `).all(pattern, pattern, opts.source, limit);
      } else {
        rows = sqlite.prepare(`
          SELECT id, title, summary, source, source_type, uri FROM objects
          WHERE title LIKE ? OR summary LIKE ?
          ORDER BY last_synced_at DESC LIMIT ?
        `).all(pattern, pattern, limit);
      }

      if ((rows as unknown[]).length === 0) {
        console.log(`No results for "${query}"`);
      } else {
        for (const row of rows as Array<{ title: string; source: string; source_type: string; summary: string }>) {
          console.log(`[${row.source}/${row.source_type}] ${row.title}`);
          if (row.summary) console.log(`  ${row.summary.slice(0, 100)}`);
          console.log('');
        }
        console.log(`${(rows as unknown[]).length} results`);
      }

      db.close();
    });
}
