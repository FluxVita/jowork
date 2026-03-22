import type { Command } from 'commander';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DbManager } from '../db/manager.js';
import { dbPath, joworkDir, fileRepoDir } from '../utils/paths.js';
import { listCredentials } from '../connectors/credential-store.js';
import { readConfig } from '../utils/config.js';
import { GitManager } from '../sync/git-manager.js';

function timeAgo(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return 'just now';
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)} hours ago`;
  return `${Math.round(diff / 86_400_000)} days ago`;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function countFilesRecursive(dir: string): number {
  if (!existsSync(dir)) return 0;
  let count = 0;
  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === '.DS_Store') continue;
      if (entry.isDirectory()) {
        count += countFilesRecursive(join(dir, entry.name));
      } else {
        count++;
      }
    }
  } catch { /* permission error etc */ }
  return count;
}

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
      const config = readConfig();

      // Header
      console.log('');
      console.log('JoWork Status');
      console.log('\u2550'.repeat(58));
      console.log('');

      // ── Per-source data table ──
      const defaultInterval = config.syncIntervalMinutes ?? 15;
      const perSourceIntervals = config.syncIntervals ?? {};

      interface SourceRow {
        source: string;
        count: number;
        size: number;
      }

      let sourceRows: SourceRow[] = [];
      try {
        sourceRows = sqlite.prepare(`
          SELECT o.source, COUNT(*) as count, COALESCE(SUM(LENGTH(ob.content)), 0) as size
          FROM objects o
          LEFT JOIN object_bodies ob ON ob.object_id = o.id
          GROUP BY o.source
          ORDER BY o.source
        `).all() as SourceRow[];
      } catch { /* tables may not exist */ }

      // Get last sync per source from sync_cursors
      const lastSyncBySource: Record<string, number> = {};
      try {
        const cursors = sqlite.prepare(
          `SELECT connector_id, MAX(last_synced_at) as last_synced_at FROM sync_cursors GROUP BY connector_id`,
        ).all() as Array<{ connector_id: string; last_synced_at: number }>;
        for (const c of cursors) {
          // connector_id may be like "feishu:chat:xxx" — extract base source
          const base = c.connector_id.split(':')[0];
          if (!lastSyncBySource[base] || c.last_synced_at > lastSyncBySource[base]) {
            lastSyncBySource[base] = c.last_synced_at;
          }
        }
      } catch { /* no sync_cursors yet */ }

      if (sourceRows.length > 0) {
        console.log('Data Sources:');
        // Header
        const hSource = 'Source'.padEnd(16);
        const hObjects = 'Objects'.padStart(8);
        const hSize = 'Size'.padStart(10);
        const hLastSync = 'Last Sync'.padEnd(20);
        const hInterval = 'Interval'.padEnd(10);
        console.log(`  ${hSource}${hObjects}${hSize}    ${hLastSync}${hInterval}`);
        console.log('  ' + '\u2500'.repeat(70));

        let totalCount = 0;
        let totalSize = 0;

        for (const row of sourceRows) {
          totalCount += row.count;
          totalSize += row.size;

          const src = row.source.padEnd(16);
          const cnt = String(row.count).padStart(8);
          const sz = formatSize(row.size).padStart(10);
          const interval = perSourceIntervals[row.source] ?? defaultInterval;
          const intervalStr = `${interval} min`.padEnd(10);
          const lastSync = lastSyncBySource[row.source]
            ? timeAgo(lastSyncBySource[row.source]).padEnd(20)
            : 'never'.padEnd(20);

          console.log(`  ${src}${cnt}${sz}    ${lastSync}${intervalStr}`);
        }

        console.log('  ' + '\u2500'.repeat(70));
        const totalSrc = 'Total'.padEnd(16);
        const totalCnt = String(totalCount).padStart(8);
        const totalSz = formatSize(totalSize).padStart(10);
        console.log(`  ${totalSrc}${totalCnt}${totalSz}`);
      } else {
        console.log('Data Sources: (none synced)');
      }

      console.log('');

      // ── Files + Git ──
      const repoDir = fileRepoDir();
      const fileCount = countFilesRecursive(repoDir);
      console.log(`Files: ${fileCount} in ~/.jowork/data/repo/`);

      try {
        const gitDir = join(repoDir, '.git');
        if (existsSync(gitDir)) {
          const gm = new GitManager(repoDir);
          const entries = await gm.getLog(1);
          if (entries.length > 0) {
            const fullLog = await gm.getLog(9999);
            const lastEntry = entries[0];
            const lastDate = timeAgo(new Date(lastEntry.date).getTime());
            console.log(`Git:   ${fullLog.length} commits, last: ${lastEntry.hash} (${lastDate})`);
          }
        }
      } catch { /* git not available */ }

      console.log('');

      // ── Connectors ──
      const creds = listCredentials();
      if (creds.length > 0) {
        const connectorLine = creds.map(name => `${name} \u2713`).join('  ');
        console.log(`Connectors: ${connectorLine}`);
      } else {
        console.log('Connectors: (none connected)');
      }

      console.log('');

      // ── Goals ──
      try {
        const goals = sqlite.prepare(`SELECT * FROM goals WHERE status = 'active'`).all() as Array<Record<string, unknown>>;
        if (goals.length > 0) {
          let totalMeasures = 0;
          let metMeasures = 0;
          for (const g of goals) {
            const measures = sqlite.prepare(
              `SELECT met FROM measures WHERE signal_id IN (SELECT id FROM signals WHERE goal_id = ?)`,
            ).all(g['id'] as string) as Array<{ met: number }>;
            totalMeasures += measures.length;
            metMeasures += measures.filter(m => m.met).length;
          }
          console.log(`Goals: ${goals.length} active (${metMeasures}/${totalMeasures} measures met)`);
        } else {
          console.log('Goals: (none active)');
        }
      } catch {
        console.log('Goals: (none)');
      }

      // ── Memories ──
      try {
        const memRow = sqlite.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
        console.log(`Memories: ${memRow.count}`);
      } catch {
        console.log('Memories: 0');
      }

      // ── DB size warning ──
      const stats = statSync(dbPath());
      const maxMB = config.maxDbSizeMB ?? 1024;
      const pct = (stats.size / (maxMB * 1024 * 1024)) * 100;
      if (pct > 80) {
        console.log('');
        console.log(`Warning: Database is ${pct.toFixed(0)}% of ${maxMB}MB limit (${formatSize(stats.size)})`);
      }

      console.log('');
      console.log('Commands:');
      console.log('  jowork sync              Sync now');
      console.log('  jowork sync --source X   Sync specific source');
      console.log('  jowork dashboard         Open visual panel');
      console.log('');

      db.close();
    });
}
