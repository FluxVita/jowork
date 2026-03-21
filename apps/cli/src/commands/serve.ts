import type { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Cron } from 'croner';
import { createJoWorkMcpServer } from '../mcp/server.js';
import { dbPath, joworkDir, logsDir } from '../utils/paths.js';
import { DbManager } from '../db/manager.js';
import { listCredentials, loadCredential } from '../connectors/credential-store.js';
import { linkAllUnprocessed } from '../sync/linker.js';

export function serveCommand(program: Command): void {
  program
    .command('serve')
    .description('Start MCP server (stdio mode for agents, or --daemon for background)')
    .option('--daemon', 'Run as background daemon with cron sync')
    .action(async (opts) => {
      const resolvedDbPath = process.env['JOWORK_DB_PATH'] ?? dbPath();
      if (!existsSync(resolvedDbPath)) {
        console.error('Error: JoWork not initialized. Run `jowork init` first.');
        process.exit(1);
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

const SYNC_INTERVAL = '*/15 * * * *'; // every 15 minutes

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

  // Load .env from cwd if available (for API credentials)
  const envFile = join(process.cwd(), '.env');
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
      const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (match) process.env[match[1]] = match[2];
    }
  }

  daemonLog('info', 'Daemon started', { pid: process.pid });

  // Run initial sync immediately
  await runSync();

  // Schedule sync every 15 minutes
  const _syncJob = new Cron(SYNC_INTERVAL, async () => {
    await runSync();
  });

  console.log(`Daemon started (PID ${process.pid})`);
  console.log(`  Sync: every 15 minutes`);
  console.log(`  PID file: ${pidFile}`);
  console.log(`  Log file: ${join(logsDir(), 'daemon.log')}`);
  console.log('  Press Ctrl+C to stop');

  // Keep process alive
  setInterval(() => {}, 60_000);
}

async function runSync(): Promise<void> {
  const sources = listCredentials();
  if (sources.length === 0) {
    daemonLog('info', 'No sources connected, skipping sync');
    return;
  }

  daemonLog('info', 'Sync cycle starting', { sources });

  let db: DbManager | null = null;
  try {
    db = new DbManager(dbPath());
    db.ensureTables();
    const sqlite = db.getSqlite();

    for (const source of sources) {
      const cred = loadCredential(source);
      if (!cred) {
        daemonLog('warn', `No credentials for ${source}, skipping`);
        continue;
      }

      try {
        switch (source) {
          case 'feishu':
            await syncFeishuDaemon(db, cred.data);
            break;
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
  } catch (err) {
    daemonLog('error', 'Sync cycle failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    db?.close();
  }

  daemonLog('info', 'Sync cycle complete');
}

/** Minimal feishu sync for daemon — reuses the same logic as sync command */
async function syncFeishuDaemon(db: DbManager, data: Record<string, string>): Promise<void> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenData = await tokenRes.json() as { code: number; tenant_access_token: string };
  if (tokenData.code !== 0) throw new Error(`Auth failed: code ${tokenData.code}`);
  const token = tokenData.tenant_access_token;

  const chatsRes = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=50', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const chatsData = await chatsRes.json() as { code: number; data: { items: Array<{ chat_id: string; name: string }> } };
  if (chatsData.code !== 0) throw new Error(`Failed to list chats: code ${chatsData.code}`);

  const chats = chatsData.data?.items ?? [];
  const sqlite = db.getSqlite();
  let totalMessages = 0;
  let newMessages = 0;

  const { createId } = await import('@jowork/core');

  for (const chat of chats) {
    const cursorRow = sqlite.prepare(`SELECT cursor FROM sync_cursors WHERE connector_id = ?`).get(`feishu:${chat.chat_id}`) as { cursor: string } | undefined;

    let pageToken: string | undefined = cursorRow?.cursor ?? undefined;
    let hasMore = true;

    while (hasMore) {
      const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
      url.searchParams.set('container_id_type', 'chat');
      url.searchParams.set('container_id', chat.chat_id);
      url.searchParams.set('page_size', '50');
      url.searchParams.set('sort_type', 'ByCreateTimeAsc');
      if (pageToken) url.searchParams.set('page_token', pageToken);

      const msgRes = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
      });
      const msgData = await msgRes.json() as {
        code: number;
        data: {
          items?: Array<{ message_id: string; msg_type: string; body?: { content?: string }; sender?: { id?: string }; create_time?: string }>;
          has_more: boolean;
          page_token?: string;
        };
      };

      if (msgData.code !== 0) {
        if (msgData.code === 99991400) {
          daemonLog('warn', `Rate limited on ${chat.name}, waiting 5s`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        daemonLog('warn', `Failed to get messages from "${chat.name}": code ${msgData.code}`);
        break;
      }

      const messages = msgData.data?.items ?? [];

      const checkExists = sqlite.prepare(`SELECT id FROM objects WHERE uri = ?`);
      const insertObj = sqlite.prepare(`
        INSERT INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertBody = sqlite.prepare(`
        INSERT OR REPLACE INTO object_bodies (object_id, content, content_type, fetched_at)
        VALUES (?, ?, ?, ?)
      `);

      const batchInsert = sqlite.transaction((msgs: typeof messages) => {
        for (const msg of msgs) {
          if (msg.msg_type !== 'text' && msg.msg_type !== 'post') continue;

          let content = '';
          try {
            const bodyContent = JSON.parse(msg.body?.content ?? '{}');
            const raw = bodyContent.text ?? bodyContent.content ?? bodyContent;
            content = typeof raw === 'string' ? raw : JSON.stringify(raw);
          } catch {
            content = msg.body?.content ?? '';
          }
          if (!content || typeof content !== 'string') continue;

          const uri = `feishu://message/${msg.message_id}`;
          const existing = checkExists.get(uri) as { id: string } | undefined;
          if (existing) continue;

          const hash = simpleHash(content);
          const now = Date.now();
          const id = createId('obj');
          const createTime = msg.create_time ? parseInt(msg.create_time) : now;
          const summary = content.length > 200 ? content.slice(0, 200) + '...' : content;

          insertObj.run(id, 'feishu', 'message', uri, `${chat.name}`, summary, JSON.stringify(['feishu', 'message']), hash, now, createTime);
          insertBody.run(id, content, 'text/plain', now);
          newMessages++;
        }
      });

      for (let i = 0; i < messages.length; i += 100) {
        batchInsert(messages.slice(i, i + 100));
      }

      totalMessages += messages.length;
      hasMore = msgData.data.has_more;
      pageToken = msgData.data.page_token;

      if (pageToken) {
        sqlite.prepare(`INSERT OR REPLACE INTO sync_cursors (connector_id, cursor, last_synced_at) VALUES (?, ?, ?)`)
          .run(`feishu:${chat.chat_id}`, pageToken, Date.now());
      }
    }
  }

  try {
    sqlite.exec(`INSERT INTO objects_fts(objects_fts) VALUES('rebuild')`);
  } catch { /* FTS might not exist yet */ }

  daemonLog('info', 'Feishu sync complete', { totalMessages, newMessages, chats: chats.length });
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}
