import type { Command } from 'commander';
import { existsSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { dbPath } from '../utils/paths.js';
import { loadCredential, listCredentials } from '../connectors/credential-store.js';
import { logInfo, logError } from '../utils/logger.js';
import { createId } from '@jowork/core';
import { linkAllUnprocessed } from '../sync/linker.js';

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
            case 'feishu':
              await syncFeishu(db, cred.data);
              break;
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

async function syncFeishu(db: DbManager, data: Record<string, string>): Promise<void> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  // Get tenant access token
  const tokenRes = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const tokenData = await tokenRes.json() as { code: number; tenant_access_token: string };
  if (tokenData.code !== 0) throw new Error(`Auth failed: code ${tokenData.code}`);
  const token = tokenData.tenant_access_token;

  // Get chat list
  const chatsRes = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=50', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const chatsData = await chatsRes.json() as { code: number; data: { items: Array<{ chat_id: string; name: string }> } };
  if (chatsData.code !== 0) throw new Error(`Failed to list chats: code ${chatsData.code}`);

  const chats = chatsData.data?.items ?? [];
  console.log(`  Found ${chats.length} chats`);

  const sqlite = db.getSqlite();
  let totalMessages = 0;
  let newMessages = 0;

  for (const chat of chats) {
    // Get cursor for this chat
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
          // Rate limit
          console.log(`  Rate limited on ${chat.name}, waiting 5s...`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        console.log(`  \u26A0 Failed to get messages from "${chat.name}": code ${msgData.code}`);
        break;
      }

      const messages = msgData.data?.items ?? [];

      // Batch insert (100 per transaction)
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

          // Skip if already synced (dedupe by URI)
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

      // Insert in batches of 100
      for (let i = 0; i < messages.length; i += 100) {
        batchInsert(messages.slice(i, i + 100));
      }

      totalMessages += messages.length;
      hasMore = msgData.data.has_more;
      pageToken = msgData.data.page_token;

      // Save cursor after each page
      if (pageToken) {
        sqlite.prepare(`INSERT OR REPLACE INTO sync_cursors (connector_id, cursor, last_synced_at) VALUES (?, ?, ?)`)
          .run(`feishu:${chat.chat_id}`, pageToken, Date.now());
      }
    }
  }

  // Update FTS index — contentless FTS5 requires manual INSERT per row
  try {
    // Find objects not yet in FTS (use rowid tracking)
    const unindexed = sqlite.prepare(`
      SELECT o.rowid, o.title, o.summary, o.tags, o.source, o.source_type,
             SUBSTR(COALESCE(ob.content, ''), 1, 500) as body_excerpt
      FROM objects o
      LEFT JOIN object_bodies ob ON ob.object_id = o.id
      WHERE o.rowid NOT IN (SELECT rowid FROM objects_fts)
    `).all() as Array<{ rowid: number; title: string; summary: string; tags: string; source: string; source_type: string; body_excerpt: string }>;

    if (unindexed.length > 0) {
      const insertFts = sqlite.prepare(`
        INSERT INTO objects_fts(rowid, title, summary, tags, source, source_type, body_excerpt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const ftsTransaction = sqlite.transaction(() => {
        for (const row of unindexed) {
          insertFts.run(row.rowid, row.title ?? '', row.summary ?? '', row.tags ?? '', row.source, row.source_type, row.body_excerpt ?? '');
        }
      });
      ftsTransaction();
      logInfo('sync', `FTS index updated: ${unindexed.length} new entries`);
    }
  } catch (err) {
    logError('sync', `FTS index update failed: ${err}`);
  }

  console.log(`  \u2713 Synced ${totalMessages} messages (${newMessages} new)`);
  logInfo('sync', 'Feishu sync complete', { totalMessages, newMessages, chats: chats.length });
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}
