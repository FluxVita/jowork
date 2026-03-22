import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Cron } from 'croner';
import { createJoWorkMcpServer } from '../mcp/server.js';
import { dbPath, joworkDir, logsDir, fileRepoDir } from '../utils/paths.js';
import { DbManager } from '../db/manager.js';
import { listCredentials, loadCredential } from '../connectors/credential-store.js';
import { linkAllUnprocessed } from '../sync/linker.js';
import { syncFeishu, syncFeishuMeetings, syncFeishuDocs, syncFeishuApprovals, type FeishuSyncLogger } from '../sync/feishu.js';
import { syncGitHub } from '../sync/github.js';
import { syncGitLab } from '../sync/gitlab.js';
import { syncLinear } from '../sync/linear.js';
import { syncPostHog } from '../sync/posthog.js';
import { syncFirebase } from '../sync/firebase.js';
import { FileWriter } from '../sync/file-writer.js';
import { GitManager, type SyncSummary } from '../sync/git-manager.js';
import { pollSignals } from '../goals/signal-poller.js';
import { evaluateTriggers } from '../goals/trigger-engine.js';
import { runCompaction } from '../memory/compaction.js';
import { readConfig } from '../utils/config.js';

export function serveCommand(program: Command): void {
  program
    .command('serve')
    .description('Start MCP server (stdio mode for agents, or --daemon for background)')
    .option('--daemon', 'Run as background daemon with cron sync')
    .action(async (opts) => {
      const resolvedDbPath = process.env['JOWORK_DB_PATH'] ?? dbPath();
      if (!existsSync(resolvedDbPath)) {
        // Auto-init on first serve — so MCP server works immediately after install
        const { writeConfig } = await import('../utils/config.js');
        const db = new DbManager(dbPath());
        db.ensureTables();
        db.close();
        writeConfig({ version: '0.1.0', initialized: true, connectors: {} });
      }

      if (opts.daemon) {
        await startDaemon();
        return;
      }

      // stdio mode — MCP server for agents
      const server = createJoWorkMcpServer({ dbPath: resolvedDbPath });
      const transport = new StdioServerTransport();
      await server.connect(transport);
    });
}

// ── Daemon mode ──────────────────────────────────────────────────────

function daemonLog(level: string, msg: string, ctx?: Record<string, unknown>): void {
  const logFile = join(logsDir(), 'daemon.log');
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  });
  appendFileSync(logFile, entry + '\n');
}

const daemonSyncLogger: FeishuSyncLogger = {
  info: (msg, ctx) => daemonLog('info', msg, ctx),
  warn: (msg, ctx) => daemonLog('warn', msg, ctx),
  error: (msg, ctx) => daemonLog('error', msg, ctx),
};

async function startDaemon(): Promise<void> {
  const pidFile = join(joworkDir(), 'daemon.pid');

  // PID file protection — prevent duplicate daemons
  if (existsSync(pidFile)) {
    const existingPid = readFileSync(pidFile, 'utf-8').trim();
    try {
      process.kill(parseInt(existingPid, 10), 0); // Check if process exists
      console.error(`Daemon already running (PID ${existingPid}). Kill it first or delete ${pidFile}`);
      process.exit(1);
    } catch {
      // Process doesn't exist, stale PID file — safe to overwrite
    }
  }

  mkdirSync(joworkDir(), { recursive: true });
  writeFileSync(pidFile, process.pid.toString());

  // Graceful shutdown — clean up PID file
  const cleanup = (): void => {
    try { unlinkSync(pidFile); } catch { /* already gone */ }
    daemonLog('info', 'Daemon stopped');
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  const config = readConfig();
  const intervalMinutes = config.syncIntervalMinutes ?? 15;
  const cronExpr = `*/${intervalMinutes} * * * *`;

  daemonLog('info', 'Daemon started', { pid: process.pid, intervalMinutes });

  // Run initial sync immediately
  await runSync();

  // Schedule sync at configured interval
  const _syncJob = new Cron(cronExpr, async () => {
    await runSync();
  });

  console.log(`Daemon started (PID ${process.pid})`);
  console.log(`  Sync: every ${intervalMinutes} minutes`);
  console.log(`  PID file: ${pidFile}`);
  console.log(`  Log file: ${join(logsDir(), 'daemon.log')}`);
  console.log('  Press Ctrl+C to stop');

  // Keep process alive
  setInterval(() => {}, 60_000);
}

/** Check if a source should be skipped based on its per-source sync interval */
function shouldSkipSource(
  sqlite: import('better-sqlite3').Database,
  source: string,
  config: ReturnType<typeof readConfig>,
): boolean {
  const perSource = config.syncIntervals;
  if (!perSource || !(source in perSource)) return false;

  const intervalMs = perSource[source] * 60_000;
  try {
    const cursor = sqlite.prepare(
      `SELECT last_synced_at FROM sync_cursors WHERE connector_id LIKE ? ORDER BY last_synced_at DESC LIMIT 1`,
    ).get(`${source}%`) as { last_synced_at: number } | undefined;
    if (!cursor) return false; // Never synced — don't skip
    return Date.now() - cursor.last_synced_at < intervalMs;
  } catch {
    return false;
  }
}

async function runSync(): Promise<void> {
  const sources = listCredentials();
  if (sources.length === 0) {
    daemonLog('info', 'No sources connected, skipping sync');
    return;
  }

  daemonLog('info', 'Sync cycle starting', { sources });

  // Initialize git repo before syncing so init commit only contains .gitignore
  let gitManager: GitManager | null = null;
  try {
    gitManager = new GitManager(fileRepoDir());
    await gitManager.init();
  } catch {
    // Git not available — daemon sync continues without version tracking
  }

  const syncResults: SyncSummary['sources'] = [];
  let db: DbManager | null = null;
  try {
    db = new DbManager(dbPath());
    db.ensureTables();
    const sqlite = db.getSqlite();
    const fileWriter = new FileWriter();

    const syncConfig = readConfig();
    for (const source of sources) {
      if (shouldSkipSource(sqlite, source, syncConfig)) {
        daemonLog('info', `Skipping ${source} — within per-source interval`);
        continue;
      }
      const cred = loadCredential(source);
      if (!cred) {
        daemonLog('warn', `No credentials for ${source}, skipping`);
        continue;
      }

      try {
        switch (source) {
          case 'feishu': {
            const r = await syncFeishu(sqlite, cred.data, daemonSyncLogger, fileWriter);
            syncResults.push({ source: 'feishu', newObjects: r.newMessages, label: 'messages' });
            try {
              const mr = await syncFeishuMeetings(sqlite, cred.data, daemonSyncLogger, fileWriter);
              syncResults.push({ source: 'feishu/meetings', newObjects: mr.newObjects, label: 'events' });
            } catch (e) { daemonLog('warn', `Feishu meetings sync: ${e}`); }
            try {
              const dr = await syncFeishuDocs(sqlite, cred.data, daemonSyncLogger, fileWriter);
              syncResults.push({ source: 'feishu/docs', newObjects: dr.newObjects, label: 'docs' });
            } catch (e) { daemonLog('warn', `Feishu docs sync: ${e}`); }
            try {
              const ar = await syncFeishuApprovals(sqlite, cred.data, daemonSyncLogger, fileWriter);
              syncResults.push({ source: 'feishu/approvals', newObjects: ar.newObjects, label: 'approvals' });
            } catch (e) { daemonLog('warn', `Feishu approvals sync: ${e}`); }
            break;
          }
          case 'github': {
            const r = await syncGitHub(sqlite, cred.data, daemonSyncLogger, fileWriter);
            syncResults.push({ source: 'github', newObjects: r.newObjects });
            break;
          }
          case 'gitlab': {
            const r = await syncGitLab(sqlite, cred.data, daemonSyncLogger, fileWriter);
            syncResults.push({ source: 'gitlab', newObjects: r.newObjects });
            break;
          }
          case 'linear': {
            const r = await syncLinear(sqlite, cred.data, daemonSyncLogger, fileWriter);
            syncResults.push({ source: 'linear', newObjects: r.newObjects, label: 'issues' });
            break;
          }
          case 'posthog': {
            const r = await syncPostHog(sqlite, cred.data, daemonSyncLogger, fileWriter);
            syncResults.push({ source: 'posthog', newObjects: r.newObjects });
            break;
          }
          case 'firebase': {
            const r = await syncFirebase(sqlite, cred.data, daemonSyncLogger, fileWriter);
            syncResults.push({ source: 'firebase', newObjects: r.newObjects, label: 'events' });
            break;
          }
          default:
            daemonLog('info', `Source ${source} sync not implemented yet`);
        }
      } catch (err) {
        daemonLog('error', `Failed to sync ${source}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Run entity extraction on newly synced objects
    const { processed, linksCreated } = linkAllUnprocessed(sqlite);
    if (processed > 0) {
      daemonLog('info', 'Entity extraction complete', { processed, linksCreated });
    }

    // Poll signals
    const pollResult = await pollSignals(sqlite);
    if (pollResult.polled > 0) {
      daemonLog('info', 'Signal polling complete', { ...pollResult });
    }

    // Evaluate triggers
    const triggerResult = evaluateTriggers(sqlite);
    if (triggerResult.triggersFired > 0) {
      daemonLog('info', 'Triggers fired', {
        count: triggerResult.triggersFired,
        notifications: triggerResult.notifications.map(n => n.message),
      });
      // TODO: Send notifications via push_to_channel when channel push is configured
    }

    // Run compaction
    const compactionResult = await runCompaction(sqlite);
    if (compactionResult.hotEntries > 0 || compactionResult.warmEntries > 0) {
      daemonLog('info', 'Compaction complete', { hotEntries: compactionResult.hotEntries, warmEntries: compactionResult.warmEntries });
    }
  } catch (err) {
    daemonLog('error', 'Sync cycle failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    db?.close();
  }

  // Git commit sync results
  if (gitManager) {
    try {
      const sha = await gitManager.commitSync({
        timestamp: new Date().toISOString(),
        sources: syncResults,
      });
      if (sha) {
        daemonLog('info', `Git committed sync: ${sha.slice(0, 7)}`);
      }
    } catch (err) {
      daemonLog('warn', `Git commit failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  daemonLog('info', 'Sync cycle complete');
}
