import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { logInfo, logError } from '../utils/logger.js';

export interface FeishuSyncResult {
  totalMessages: number;
  newMessages: number;
  chats: number;
}

export interface FeishuSyncLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

const defaultLogger: FeishuSyncLogger = {
  info: (msg, ctx) => logInfo('sync', msg, ctx),
  warn: (msg, ctx) => logError('sync', msg, ctx),
  error: (msg, ctx) => logError('sync', msg, ctx),
};

/** SHA-256 content hash for deduplication. */
export function contentHash(str: string): string {
  return createHash('sha256').update(str).digest('hex').slice(0, 16);
}

/** Feishu tenant access token. */
export async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json() as { code: number; tenant_access_token: string };
  if (data.code !== 0) throw new Error(`Feishu auth failed: code ${data.code}`);
  return data.tenant_access_token;
}

/** Sync Feishu messages — shared between `jowork sync` and `jowork serve --daemon`. */
export async function syncFeishu(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: FeishuSyncLogger = defaultLogger,
): Promise<FeishuSyncResult> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  const token = await getFeishuToken(appId, appSecret);

  // Get chat list
  const chatsRes = await fetch('https://open.feishu.cn/open-apis/im/v1/chats?page_size=50', {
    headers: { Authorization: `Bearer ${token}` },
  });
  const chatsData = await chatsRes.json() as { code: number; data: { items: Array<{ chat_id: string; name: string }> } };
  if (chatsData.code !== 0) throw new Error(`Failed to list chats: code ${chatsData.code}`);

  const chats = chatsData.data?.items ?? [];
  let totalMessages = 0;
  let newMessages = 0;

  const checkExists = sqlite.prepare('SELECT id FROM objects WHERE uri = ?');
  const insertObj = sqlite.prepare(`
    INSERT INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBody = sqlite.prepare(`
    INSERT OR REPLACE INTO object_bodies (object_id, content, content_type, fetched_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = sqlite.prepare(`
    INSERT INTO objects_fts(rowid, title, summary, tags, source, source_type, body_excerpt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getRowid = sqlite.prepare('SELECT rowid FROM objects WHERE id = ?');

  for (const chat of chats) {
    const cursorRow = sqlite.prepare('SELECT cursor FROM sync_cursors WHERE connector_id = ?')
      .get(`feishu:${chat.chat_id}`) as { cursor: string } | undefined;

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
          logger.warn(`Rate limited on ${chat.name}, waiting 5s`);
          await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        logger.warn(`Failed to get messages from "${chat.name}": code ${msgData.code}`);
        break;
      }

      const messages = msgData.data?.items ?? [];

      // Batch insert with incremental FTS update (100 per transaction)
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

          const hash = contentHash(content);
          const now = Date.now();
          const id = createId('obj');
          const createTime = msg.create_time ? parseInt(msg.create_time) : now;
          const summary = content.length > 200 ? content.slice(0, 200) + '...' : content;
          const tags = JSON.stringify(['feishu', 'message']);

          insertObj.run(id, 'feishu', 'message', uri, chat.name, summary, tags, hash, now, createTime);
          insertBody.run(id, content, 'text/plain', now);

          // Incremental FTS update — insert immediately after object creation
          try {
            const rowid = getRowid.get(id) as { rowid: number } | undefined;
            if (rowid) {
              const excerpt = content.length > 500 ? content.slice(0, 500) : content;
              insertFts.run(rowid.rowid, chat.name ?? '', summary ?? '', tags, 'feishu', 'message', excerpt);
            }
          } catch { /* FTS insert non-critical */ }

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
        sqlite.prepare('INSERT OR REPLACE INTO sync_cursors (connector_id, cursor, last_synced_at) VALUES (?, ?, ?)')
          .run(`feishu:${chat.chat_id}`, pageToken, Date.now());
      }
    }
  }

  logger.info('Feishu sync complete', { totalMessages, newMessages, chats: chats.length });
  return { totalMessages, newMessages, chats: chats.length };
}

// ── Feishu Meetings (Calendar Events) ────────────────────────────────

export interface FeishuMeetingSyncResult {
  meetings: number;
  newObjects: number;
}

/**
 * Sync Feishu calendar events from the last 7 days.
 * Requires scopes: calendar:calendar:readonly
 */
export async function syncFeishuMeetings(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: FeishuSyncLogger = defaultLogger,
): Promise<FeishuMeetingSyncResult> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  const token = await getFeishuToken(appId, appSecret);
  let meetings = 0, newObjects = 0;

  try {
    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 7 * 24 * 60 * 60;

    // List calendars
    const calRes = await fetch('https://open.feishu.cn/open-apis/calendar/v4/calendars?page_size=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const calData = await calRes.json() as {
      code: number;
      data: { items?: Array<{ calendar_id: string; summary: string }> };
    };
    if (calData.code !== 0 || !calData.data?.items) {
      logger.warn(`Calendar API returned code ${calData.code}`);
      return { meetings, newObjects };
    }

    const checkExists = sqlite.prepare('SELECT id FROM objects WHERE uri = ?');
    const insertObj = sqlite.prepare(`
      INSERT INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertBody = sqlite.prepare(`
      INSERT OR REPLACE INTO object_bodies (object_id, content, content_type, fetched_at)
      VALUES (?, ?, ?, ?)
    `);
    const insertFts = sqlite.prepare(`
      INSERT INTO objects_fts(rowid, title, summary, tags, source, source_type, body_excerpt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const getRowid = sqlite.prepare('SELECT rowid FROM objects WHERE id = ?');

    for (const cal of calData.data.items) {
      const eventsRes = await fetch(
        `https://open.feishu.cn/open-apis/calendar/v4/calendars/${cal.calendar_id}/events?start_time=${weekAgo}&end_time=${now}&page_size=50`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      const eventsData = await eventsRes.json() as {
        code: number;
        data: {
          items?: Array<{
            event_id: string; summary: string; description: string;
            start_time: { timestamp: string }; end_time: { timestamp: string };
            attendees?: Array<{ display_name: string }>;
          }>;
        };
      };

      if (eventsData.code !== 0 || !eventsData.data?.items) continue;

      const batch = sqlite.transaction((events: NonNullable<typeof eventsData.data.items>) => {
        for (const event of events) {
          const uri = `feishu://calendar/${cal.calendar_id}/event/${event.event_id}`;
          if (checkExists.get(uri)) continue;

          const nowMs = Date.now();
          const id = createId('obj');
          const attendees = event.attendees?.map(a => a.display_name).join(', ') ?? '';
          const startTs = parseInt(event.start_time?.timestamp ?? '0') * 1000;
          const startTime = new Date(startTs).toLocaleString('zh-CN');
          const summary = `${event.summary} (${startTime}, ${attendees || 'no attendees'})`;
          const body = [
            `Meeting: ${event.summary}`,
            `Time: ${startTime}`,
            `Attendees: ${attendees}`,
            `Description: ${event.description || '(none)'}`,
          ].join('\n');
          const tags = JSON.stringify(['feishu', 'calendar', 'meeting']);

          insertObj.run(id, 'feishu', 'calendar_event', uri, event.summary || 'Untitled meeting', summary, tags, contentHash(body), nowMs, startTs);
          insertBody.run(id, body, 'text/plain', nowMs);

          // Incremental FTS
          try {
            const rowid = getRowid.get(id) as { rowid: number } | undefined;
            if (rowid) {
              const excerpt = body.length > 500 ? body.slice(0, 500) : body;
              insertFts.run(rowid.rowid, event.summary ?? '', summary ?? '', tags, 'feishu', 'calendar_event', excerpt);
            }
          } catch { /* FTS insert non-critical */ }

          meetings++;
          newObjects++;
        }
      });
      batch(eventsData.data.items);

      await new Promise(r => setTimeout(r, 200)); // Rate limit
    }
  } catch (err) {
    logger.error(`Meeting sync error: ${err}`);
  }

  logger.info('Meeting sync complete', { meetings, newObjects });
  return { meetings, newObjects };
}

// ── Feishu Documents (Wiki / Docs) ───────────────────────────────────

export interface FeishuDocsSyncResult {
  docs: number;
  newObjects: number;
}

/**
 * Sync Feishu wiki documents.
 * Requires scopes: wiki:wiki:readonly, docx:document:readonly
 */
export async function syncFeishuDocs(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: FeishuSyncLogger = defaultLogger,
): Promise<FeishuDocsSyncResult> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  const token = await getFeishuToken(appId, appSecret);
  let docs = 0, newObjects = 0;

  const checkExists = sqlite.prepare('SELECT id FROM objects WHERE uri = ?');
  const insertObj = sqlite.prepare(`
    INSERT INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBody = sqlite.prepare(`
    INSERT OR REPLACE INTO object_bodies (object_id, content, content_type, fetched_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = sqlite.prepare(`
    INSERT INTO objects_fts(rowid, title, summary, tags, source, source_type, body_excerpt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getRowid = sqlite.prepare('SELECT rowid FROM objects WHERE id = ?');

  try {
    // List wiki spaces first, then nodes in each space
    const spacesRes = await fetch('https://open.feishu.cn/open-apis/wiki/v2/spaces?page_size=10', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const spacesData = await spacesRes.json() as {
      code: number;
      data: { items?: Array<{ space_id: string; name: string }> };
    };

    if (spacesData.code === 0 && spacesData.data?.items?.length) {
      // Iterate spaces and fetch top-level nodes
      for (const space of spacesData.data.items) {
        const nodesRes = await fetch(
          `https://open.feishu.cn/open-apis/wiki/v2/spaces/${space.space_id}/nodes?page_size=50`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        const nodesData = await nodesRes.json() as {
          code: number;
          data: { items?: Array<{ node_token: string; title: string; obj_type: string; obj_token: string; has_child: boolean }> };
        };

        if (nodesData.code !== 0 || !nodesData.data?.items) continue;

        const batch = sqlite.transaction((nodes: NonNullable<typeof nodesData.data.items>) => {
          for (const node of nodes) {
            const uri = `feishu://wiki/${space.space_id}/${node.node_token}`;
            if (checkExists.get(uri)) continue;

            const nowMs = Date.now();
            const id = createId('obj');
            const tags = JSON.stringify(['feishu', 'document', node.obj_type]);

            insertObj.run(id, 'feishu', 'document', uri, node.title, node.title, tags, contentHash(node.title + node.node_token), nowMs, nowMs);
            insertBody.run(id, `Wiki: ${node.title} (${node.obj_type}, space: ${space.name})`, 'text/plain', nowMs);

            // Incremental FTS
            try {
              const rowid = getRowid.get(id) as { rowid: number } | undefined;
              if (rowid) {
                insertFts.run(rowid.rowid, node.title ?? '', node.title ?? '', tags, 'feishu', 'document', `Wiki: ${node.title}`);
              }
            } catch { /* FTS insert non-critical */ }

            docs++;
            newObjects++;
          }
        });
        batch(nodesData.data.items);

        await new Promise(r => setTimeout(r, 200)); // Rate limit
      }
    } else {
      // Fallback: search wiki nodes directly
      const searchRes = await fetch('https://open.feishu.cn/open-apis/wiki/v1/nodes/search', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: '', page_size: 50 }),
      });

      if (searchRes.ok) {
        const searchData = await searchRes.json() as {
          code: number;
          data: { items?: Array<{ space_id: string; node_token: string; title: string; obj_type: string }> };
        };
        if (searchData.code === 0 && searchData.data?.items) {
          const batch = sqlite.transaction((nodes: NonNullable<typeof searchData.data.items>) => {
            for (const node of nodes) {
              const uri = `feishu://wiki/${node.space_id}/${node.node_token}`;
              if (checkExists.get(uri)) continue;

              const nowMs = Date.now();
              const id = createId('obj');
              const tags = JSON.stringify(['feishu', 'document', node.obj_type]);

              insertObj.run(id, 'feishu', 'document', uri, node.title, node.title, tags, contentHash(node.title + node.node_token), nowMs, nowMs);
              insertBody.run(id, `Wiki: ${node.title} (${node.obj_type})`, 'text/plain', nowMs);

              try {
                const rowid = getRowid.get(id) as { rowid: number } | undefined;
                if (rowid) {
                  insertFts.run(rowid.rowid, node.title ?? '', node.title ?? '', tags, 'feishu', 'document', `Wiki: ${node.title}`);
                }
              } catch { /* FTS insert non-critical */ }

              docs++;
              newObjects++;
            }
          });
          batch(searchData.data.items);
        }
      }
    }
  } catch (err) {
    logger.error(`Document sync error: ${err}`);
  }

  logger.info('Document sync complete', { docs, newObjects });
  return { docs, newObjects };
}
