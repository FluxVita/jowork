import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { logInfo, logError } from '../utils/logger.js';
import type { FileWriter } from './file-writer.js';
import { formatCalendarEvent, formatApproval, formatDocument } from './formatters.js';

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
  fileWriter?: FileWriter,
): Promise<FeishuSyncResult> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  const token = await getFeishuToken(appId, appSecret);

  // Get chat list with pagination
  const chats: Array<{ chat_id: string; name: string }> = [];
  let chatPageToken: string | undefined;
  let hasMoreChats = true;

  while (hasMoreChats) {
    const chatUrl = new URL('https://open.feishu.cn/open-apis/im/v1/chats');
    chatUrl.searchParams.set('page_size', '100');
    if (chatPageToken) chatUrl.searchParams.set('page_token', chatPageToken);

    const chatsRes = await fetch(chatUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const chatsData = await chatsRes.json() as {
      code: number;
      data: {
        items?: Array<{ chat_id: string; name: string }>;
        has_more?: boolean;
        page_token?: string;
      };
    };
    if (chatsData.code !== 0) throw new Error(`Failed to list chats: code ${chatsData.code}`);

    chats.push(...(chatsData.data?.items ?? []));
    hasMoreChats = chatsData.data?.has_more ?? false;
    chatPageToken = chatsData.data?.page_token;
  }
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

  // Collect messages per day for file writing
  type DayMessage = { time: string; sender: string; content: string };
  const dayMessages = new Map<string, { chatName: string; chatId: string; date: string; messages: DayMessage[] }>();

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

          // Collect for file writing — group by day
          if (fileWriter) {
            const date = new Date(createTime).toISOString().slice(0, 10);
            const time = new Date(createTime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
            const key = `${chat.chat_id}:${date}`;
            let group = dayMessages.get(key);
            if (!group) {
              group = { chatName: chat.name, chatId: chat.chat_id, date, messages: [] };
              dayMessages.set(key, group);
            }
            group.messages.push({ time, sender: msg.sender?.id ?? 'unknown', content });
          }

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

  // Write collected messages to file repo grouped by day
  if (fileWriter && dayMessages.size > 0) {
    for (const group of dayMessages.values()) {
      try {
        const filePath = fileWriter.appendMessages(
          'feishu', group.chatName, group.chatId, group.date, group.messages,
        );
        // Update file_path for all objects in this chat+day (best effort)
        sqlite.prepare(
          `UPDATE objects SET file_path = ? WHERE source = 'feishu' AND source_type = 'message' AND title = ? AND file_path IS NULL`,
        ).run(filePath, group.chatName);
      } catch (err) {
        logger.warn(`Failed to write messages file for ${group.chatName}/${group.date}: ${err}`);
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
  fileWriter?: FileWriter,
): Promise<FeishuMeetingSyncResult> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  const token = await getFeishuToken(appId, appSecret);
  let meetings = 0, newObjects = 0;

  try {
    const now = Math.floor(Date.now() / 1000);
    const weekAgo = now - 30 * 24 * 60 * 60;

    // List calendars (min page_size is 50 per Feishu API)
    const calRes = await fetch('https://open.feishu.cn/open-apis/calendar/v4/calendars?page_size=50', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const calData = await calRes.json() as {
      code: number;
      data: { calendar_list?: Array<{ calendar_id: string; summary: string }> };
    };
    if (calData.code !== 0 || !calData.data?.calendar_list?.length) {
      if (calData.code === 99992402) {
        logger.warn('Calendar sync requires calendar:calendar:readonly scope. Add it at https://open.feishu.cn/app → Permissions');
      } else if (calData.code !== 0) {
        logger.warn(`Calendar API returned code ${calData.code}`);
      }
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

    for (const cal of calData.data.calendar_list) {
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

          // Write to file repo
          if (fileWriter) {
            try {
              const attendeeNames = event.attendees?.map(a => a.display_name) ?? [];
              const endTs = parseInt(event.end_time?.timestamp ?? '0') * 1000;
              const endTime = new Date(endTs).toLocaleString('zh-CN');
              const date = new Date(startTs).toISOString().slice(0, 10);
              const fileContent = formatCalendarEvent({
                source: 'feishu', title: event.summary || 'Untitled meeting',
                startTime, endTime, attendees: attendeeNames,
                description: event.description || '', uri,
              });
              const filePath = fileWriter.writeObject('feishu', 'calendar_event', {
                id, title: event.summary, date,
              }, fileContent);
              sqlite.prepare('UPDATE objects SET file_path = ? WHERE id = ?').run(filePath, id);
            } catch { /* file write non-critical */ }
          }

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

// ── Feishu Approvals ─────────────────────────────────────────────────

export interface FeishuApprovalSyncResult {
  approvals: number;
  newObjects: number;
}

/**
 * Sync Feishu approval instances.
 * Requires scope: approval:approval:readonly
 * API: GET /open-apis/approval/v4/instances
 */
export async function syncFeishuApprovals(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: FeishuSyncLogger = defaultLogger,
  fileWriter?: FileWriter,
): Promise<FeishuApprovalSyncResult> {
  const { appId, appSecret } = data;
  if (!appId || !appSecret) throw new Error('Missing Feishu credentials');

  const token = await getFeishuToken(appId, appSecret);
  let approvals = 0, newObjects = 0;

  try {
    // List approval instances (last 30 days)
    const res = await fetch('https://open.feishu.cn/open-apis/approval/v4/instances?page_size=50', {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok || res.status === 400) {
      logger.warn('Approval sync requires approval:approval:readonly scope. Add it at https://open.feishu.cn/app → Permissions');
      return { approvals, newObjects };
    }

    const resData = await res.json() as {
      code: number;
      data: {
        items?: Array<{
          instance_id: string;
          approval_name: string;
          status: string;
          user_id: string;
          start_time: string;
          end_time: string;
          form: string; // JSON string of form fields
        }>;
      };
    };

    if (resData.code !== 0 || !resData.data?.items) {
      logger.warn(`Approval list returned code ${resData.code}`);
      return { approvals, newObjects };
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

    const batch = sqlite.transaction((items: NonNullable<typeof resData.data.items>) => {
      for (const approval of items) {
        const uri = `feishu://approval/${approval.instance_id}`;
        if (checkExists.get(uri)) continue;

        const nowMs = Date.now();
        const id = createId('obj');
        const summary = `${approval.approval_name} [${approval.status}]`;
        const tags = JSON.stringify(['feishu', 'approval', approval.status]);

        let formText = '';
        try {
          const formData = JSON.parse(approval.form || '[]');
          formText = Array.isArray(formData)
            ? formData.map((f: { name: string; value: string }) => `${f.name}: ${f.value}`).join('\n')
            : JSON.stringify(formData);
        } catch {
          formText = approval.form || '';
        }

        const body = [
          `Approval: ${approval.approval_name}`,
          `Status: ${approval.status}`,
          `Submitted: ${approval.start_time}`,
          `Completed: ${approval.end_time || 'pending'}`,
          '',
          formText,
        ].join('\n');

        const startTime = approval.start_time ? new Date(approval.start_time).getTime() : nowMs;
        insertObj.run(id, 'feishu', 'approval', uri, approval.approval_name, summary, tags, contentHash(body), nowMs, startTime);
        insertBody.run(id, body, 'text/plain', nowMs);

        // Incremental FTS
        try {
          const rowid = getRowid.get(id) as { rowid: number } | undefined;
          if (rowid) {
            const excerpt = body.length > 500 ? body.slice(0, 500) : body;
            insertFts.run(rowid.rowid, approval.approval_name ?? '', summary ?? '', tags, 'feishu', 'approval', excerpt);
          }
        } catch { /* FTS insert non-critical */ }

        // Write to file repo
        if (fileWriter) {
          try {
            let formFields: Array<{ name: string; value: string }> = [];
            try {
              const fd = JSON.parse(approval.form || '[]');
              if (Array.isArray(fd)) formFields = fd;
            } catch { /* ignore */ }
            const fileContent = formatApproval({
              source: 'feishu', name: approval.approval_name,
              status: approval.status, submitter: approval.user_id || 'unknown',
              fields: formFields, uri,
            });
            const filePath = fileWriter.writeObject('feishu', 'approval', {
              id, title: approval.approval_name,
            }, fileContent);
            sqlite.prepare('UPDATE objects SET file_path = ? WHERE id = ?').run(filePath, id);
          } catch { /* file write non-critical */ }
        }

        approvals++;
        newObjects++;
      }
    });
    batch(resData.data.items);
  } catch (err) {
    logger.error(`Approval sync error: ${err}`);
  }

  logger.info('Approval sync complete', { approvals, newObjects });
  return { approvals, newObjects };
}

// ── Feishu Documents (Wiki / Docs) ───────────────────────────────────

export interface FeishuDocsSyncResult {
  docs: number;
  newObjects: number;
}

/**
 * Sync Feishu documents via wiki spaces + drive API fallback.
 * Requires scopes: wiki:wiki:readonly, docx:document:readonly, drive:drive:readonly
 */
export async function syncFeishuDocs(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: FeishuSyncLogger = defaultLogger,
  fileWriter?: FileWriter,
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

  /** Fetch docx raw content, returns null on failure */
  async function fetchDocContent(docToken: string): Promise<string | null> {
    try {
      const res = await fetch(
        `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}/raw_content`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return null;
      const d = await res.json() as { code?: number; data?: { content?: string } };
      return d.data?.content ?? null;
    } catch { return null; }
  }

  /** Insert a document into SQLite + file repo */
  function insertDoc(uri: string, title: string, docBody: string, objType: string, createdTs?: number) {
    if (checkExists.get(uri)) return false;
    const nowMs = Date.now();
    const id = createId('obj');
    const tags = JSON.stringify(['feishu', 'document', objType]);
    const summary = docBody.length > 200 ? docBody.slice(0, 200) + '...' : docBody;

    insertObj.run(id, 'feishu', 'document', uri, title, summary, tags, contentHash(docBody), nowMs, createdTs ?? nowMs);
    insertBody.run(id, docBody, 'text/plain', nowMs);

    try {
      const rowid = getRowid.get(id) as { rowid: number } | undefined;
      if (rowid) {
        const excerpt = docBody.length > 500 ? docBody.slice(0, 500) : docBody;
        insertFts.run(rowid.rowid, title ?? '', summary ?? '', tags, 'feishu', 'document', excerpt);
      }
    } catch { /* FTS non-critical */ }

    if (fileWriter) {
      try {
        const fileContent = formatDocument({ source: 'feishu', title, uri, body: docBody });
        const filePath = fileWriter.writeObject('feishu', 'document', { id, title }, fileContent);
        sqlite.prepare('UPDATE objects SET file_path = ? WHERE id = ?').run(filePath, id);
      } catch { /* file write non-critical */ }
    }

    docs++;
    newObjects++;
    return true;
  }

  try {
    // ── Path 1: Wiki spaces ──
    let wikiFound = 0;
    try {
      const spacesRes = await fetch('https://open.feishu.cn/open-apis/wiki/v2/spaces?page_size=50', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const spacesData = await spacesRes.json() as {
        code: number;
        data: { items?: Array<{ space_id: string; name: string }> };
      };

      if (spacesData.code === 0 && spacesData.data?.items?.length) {
        for (const space of spacesData.data.items) {
          // Paginate wiki nodes
          let nodePageToken: string | undefined;
          let hasMoreNodes = true;
          while (hasMoreNodes) {
            const url = new URL(`https://open.feishu.cn/open-apis/wiki/v2/spaces/${space.space_id}/nodes`);
            url.searchParams.set('page_size', '50');
            if (nodePageToken) url.searchParams.set('page_token', nodePageToken);

            const nodesRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
            const nodesData = await nodesRes.json() as {
              code: number;
              data: {
                items?: Array<{ node_token: string; title: string; obj_type: string; obj_token: string; has_child: boolean }>;
                has_more?: boolean;
                page_token?: string;
              };
            };

            if (nodesData.code !== 0 || !nodesData.data?.items) break;

            for (const node of nodesData.data.items) {
              const uri = `feishu://wiki/${space.space_id}/${node.node_token}`;
              let docBody = `Wiki: ${node.title} (${node.obj_type}, space: ${space.name})`;
              if (node.obj_type === 'docx' || node.obj_type === 'doc') {
                const content = await fetchDocContent(node.obj_token);
                if (content) docBody = content;
              }
              if (insertDoc(uri, node.title, docBody, node.obj_type)) wikiFound++;
              await new Promise(r => setTimeout(r, 100)); // Rate limit
            }

            hasMoreNodes = nodesData.data?.has_more ?? false;
            nodePageToken = nodesData.data?.page_token;
          }
        }
      }
    } catch (err) {
      logger.warn(`Wiki sync error (non-fatal): ${err}`);
    }

    // ── Path 2: Drive API (accessible files) ──
    let driveFound = 0;
    try {
      let drivePageToken: string | undefined;
      let hasMoreFiles = true;
      while (hasMoreFiles) {
        const url = new URL('https://open.feishu.cn/open-apis/drive/v1/files');
        url.searchParams.set('page_size', '50');
        if (drivePageToken) url.searchParams.set('page_token', drivePageToken);

        const driveRes = await fetch(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
        const driveData = await driveRes.json() as {
          code: number;
          data: {
            files?: Array<{ token: string; name: string; type: string; created_time?: string; url?: string }>;
            has_more?: boolean;
            next_page_token?: string;
          };
        };

        if (driveData.code !== 0) {
          if (driveData.code === 99992402) {
            logger.warn('Drive sync requires drive:drive:readonly scope. Add it at https://open.feishu.cn/app → Permissions');
          }
          break;
        }

        for (const file of driveData.data?.files ?? []) {
          const uri = `feishu://drive/${file.token}`;
          let docBody = `Drive: ${file.name} (${file.type})`;
          if (file.type === 'docx' || file.type === 'doc') {
            const content = await fetchDocContent(file.token);
            if (content) docBody = content;
          }
          const createdTs = file.created_time ? parseInt(file.created_time) * 1000 : undefined;
          if (insertDoc(uri, file.name, docBody, file.type, createdTs)) driveFound++;
          await new Promise(r => setTimeout(r, 100)); // Rate limit
        }

        hasMoreFiles = driveData.data?.has_more ?? false;
        drivePageToken = driveData.data?.next_page_token;
      }
    } catch (err) {
      logger.warn(`Drive sync error (non-fatal): ${err}`);
    }

    // ── Path 3: Extract doc tokens from feishu URLs in messages ──
    let msgDocFound = 0;
    try {
      const msgRows = sqlite.prepare(`
        SELECT ob.content FROM object_bodies ob
        JOIN objects o ON o.id = ob.object_id
        WHERE o.source = 'feishu' AND o.source_type = 'message'
        AND ob.content LIKE '%feishu.cn%'
      `).all() as Array<{ content: string }>;

      // Extract feishu doc URLs → doc tokens
      const docTokens = new Map<string, string>(); // token → title hint
      const feishuUrlPattern = /https?:\/\/[a-z0-9]+\.feishu\.cn\/(docx|doc|wiki|sheets|bitable|mindnote)\/([A-Za-z0-9]+)/g;
      for (const row of msgRows) {
        for (const match of row.content.matchAll(feishuUrlPattern)) {
          const docType = match[1];
          const docToken = match[2];
          if (!docTokens.has(docToken)) {
            docTokens.set(docToken, docType);
          }
        }
      }

      if (docTokens.size > 0) {
        logger.info(`Found ${docTokens.size} feishu doc links in messages`);
      }

      for (const [docToken, docType] of docTokens) {
        const uri = `feishu://doc/${docToken}`;
        if (checkExists.get(uri)) continue;

        // Fetch document metadata first
        let title = `Feishu ${docType} (${docToken})`;
        let docBody = '';

        if (docType === 'docx' || docType === 'doc') {
          // Get doc meta for title
          try {
            const metaRes = await fetch(
              `https://open.feishu.cn/open-apis/docx/v1/documents/${docToken}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (metaRes.ok) {
              const metaData = await metaRes.json() as { data?: { document?: { title?: string } } };
              if (metaData.data?.document?.title) title = metaData.data.document.title;
            }
          } catch { /* use default title */ }

          // Get content
          const content = await fetchDocContent(docToken);
          if (content) {
            docBody = content;
          } else {
            docBody = `(Content not accessible — doc may not be shared with the app)`;
          }
        } else if (docType === 'wiki') {
          // Wiki node — try to get node info
          try {
            const nodeRes = await fetch(
              `https://open.feishu.cn/open-apis/wiki/v2/spaces/get_node?token=${docToken}`,
              { headers: { Authorization: `Bearer ${token}` } },
            );
            if (nodeRes.ok) {
              const nodeData = await nodeRes.json() as {
                data?: { node?: { title?: string; obj_token?: string; obj_type?: string } };
              };
              if (nodeData.data?.node?.title) title = nodeData.data.node.title;
              if (nodeData.data?.node?.obj_token && (nodeData.data.node.obj_type === 'docx' || nodeData.data.node.obj_type === 'doc')) {
                const content = await fetchDocContent(nodeData.data.node.obj_token);
                if (content) docBody = content;
              }
            }
          } catch { /* use default */ }
          if (!docBody) docBody = `Wiki: ${title}`;
        } else {
          docBody = `Feishu ${docType}: ${title} (non-docx format, content extraction not supported)`;
        }

        if (insertDoc(uri, title, docBody, docType)) msgDocFound++;
        await new Promise(r => setTimeout(r, 200)); // Rate limit
      }

      if (msgDocFound > 0) {
        logger.info(`Extracted ${msgDocFound} docs from message links`);
      }
    } catch (err) {
      logger.warn(`Message doc extraction error (non-fatal): ${err}`);
    }

    // Only warn if no docs exist at all (not just no NEW docs)
    if (wikiFound === 0 && driveFound === 0 && msgDocFound === 0) {
      const existingDocs = (sqlite.prepare("SELECT COUNT(*) as cnt FROM objects WHERE source='feishu' AND source_type='document'").get() as { cnt: number }).cnt;
      if (existingDocs === 0) {
        logger.warn('No documents found. Ensure docs are shared with the app, or wiki spaces include the bot as member.');
      }
    }
  } catch (err) {
    logger.error(`Document sync error: ${err}`);
  }

  logger.info('Document sync complete', { docs, newObjects });
  return { docs, newObjects };
}

// ── Feishu Link Content Fetching ──────────────────────────────────

export interface FeishuLinksSyncResult {
  extracted: number;
  fetched: number;
  failed: number;
}

/** Domains/patterns that are not fetchable content (tracking links, auth-walled, internal). */
const SKIP_URL_PATTERNS = [
  /email\.quail-mail\.com/,     // Newsletter tracking redirects
  /\.feishu\.cn\//,             // Feishu internal links (handled by doc sync)
  /mp\.weixin\.qq\.com/,        // WeChat articles (need cookies)
  /open\.weixin\.qq\.com/,      // WeChat OAuth
  /xhslink\.com/,              // Xiaohongshu short links (need app)
  /b23\.tv/,                   // Bilibili short links
  /t\.co\//,                   // Twitter short links
  /luma\.com\/event/,          // Luma events (dynamic SPA)
];

/** Extract URLs from feishu message JSON content (post format with tag:"a"). */
function extractUrlsFromContent(content: string): Array<{ url: string; text: string }> {
  const urls: Array<{ url: string; text: string }> = [];
  try {
    const parsed = JSON.parse(content);
    // Feishu post format: [[{tag, text, href}, ...], ...]
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    for (const row of rows) {
      if (!Array.isArray(row)) continue;
      for (const element of row) {
        if (element?.tag === 'a' && element?.href) {
          const href = String(element.href);
          // Skip image/attachment URLs
          if (/\.(png|jpg|jpeg|gif|webp|svg|mp4|mp3|pdf|zip|rar)(\?|$)/i.test(href)) continue;
          // Skip feishu internal image/file links
          if (href.includes('/file/') || href.includes('/image/')) continue;
          // Skip known non-fetchable domains
          if (SKIP_URL_PATTERNS.some(p => p.test(href))) continue;
          urls.push({ url: href, text: element.text ?? href });
        }
      }
    }
  } catch { /* not JSON, try plain text URL extraction */ }

  // Also extract plain http(s) URLs from text content
  if (urls.length === 0) {
    const matches = content.match(/https?:\/\/[^\s"'<>\]]+/g);
    if (matches) {
      for (const url of matches) {
        if (/\.(png|jpg|jpeg|gif|webp|svg|mp4|mp3|pdf|zip|rar)(\?|$)/i.test(url)) continue;
        if (SKIP_URL_PATTERNS.some(p => p.test(url))) continue;
        urls.push({ url, text: url });
      }
    }
  }

  return urls;
}

/**
 * Fetch URL content and extract into readable markdown.
 * Uses r.jina.ai for clean markdown conversion.
 */
async function fetchUrlContent(url: string): Promise<{ title: string; content: string } | null> {
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        'Accept': 'text/markdown',
        'X-No-Cache': 'true',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (!text || text.length < 50) return null;

    // Extract title from first line (jina.ai format: "Title: xxx\n")
    const titleMatch = text.match(/^Title:\s*(.+)/m);
    let fallbackHost = url;
    try { fallbackHost = new URL(url).hostname; } catch { /* keep full url */ }
    const title = titleMatch?.[1]?.trim() ?? fallbackHost;

    return { title, content: text };
  } catch { return null; }
}

/**
 * Sync link content from feishu messages — extracts URLs and fetches their content.
 * Stores as markdown files in ~/.jowork/data/repo/feishu/links/.
 */
export async function syncFeishuLinks(
  sqlite: Database.Database,
  _data: Record<string, string>,
  logger: FeishuSyncLogger = defaultLogger,
  fileWriter?: FileWriter,
): Promise<FeishuLinksSyncResult> {
  let extracted = 0, fetched = 0, failed = 0;

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
    // Get all feishu message bodies that contain URLs
    const messageRows = sqlite.prepare(`
      SELECT ob.content FROM object_bodies ob
      JOIN objects o ON o.id = ob.object_id
      WHERE o.source = 'feishu' AND o.source_type = 'message'
      AND ob.content LIKE '%http%'
    `).all() as Array<{ content: string }>;

    // Extract and deduplicate URLs
    const urlSet = new Map<string, string>(); // url → text
    for (const row of messageRows) {
      const urls = extractUrlsFromContent(row.content);
      for (const { url, text } of urls) {
        if (!urlSet.has(url)) urlSet.set(url, text);
      }
    }

    extracted = urlSet.size;
    if (extracted === 0) {
      logger.info('No URLs found in messages');
      return { extracted, fetched, failed };
    }

    logger.info(`Found ${extracted} unique URLs in messages`);

    // Fetch each URL that isn't already in the database
    let i = 0;
    for (const [url, linkText] of urlSet) {
      i++;

      // Validate URL format
      try { new URL(url); } catch {
        failed++;
        continue;
      }

      const uri = `feishu://link/${contentHash(url)}`;
      if (checkExists.get(uri)) continue;

      const result = await fetchUrlContent(url);
      if (!result) {
        failed++;
        continue;
      }

      const nowMs = Date.now();
      const id = createId('obj');
      const title = result.title || linkText;
      const summary = result.content.length > 200 ? result.content.slice(0, 200) + '...' : result.content;
      let hostname = 'unknown';
      try { hostname = new URL(url).hostname; } catch { /* invalid URL */ }
      const tags = JSON.stringify(['feishu', 'link', hostname]);

      insertObj.run(id, 'feishu', 'link', uri, title, summary, tags, contentHash(result.content), nowMs, nowMs);
      insertBody.run(id, result.content, 'text/markdown', nowMs);

      try {
        const rowid = getRowid.get(id) as { rowid: number } | undefined;
        if (rowid) {
          const excerpt = result.content.length > 500 ? result.content.slice(0, 500) : result.content;
          insertFts.run(rowid.rowid, title, summary, tags, 'feishu', 'link', excerpt);
        }
      } catch { /* FTS non-critical */ }

      // Write to file repo
      if (fileWriter) {
        try {
          const fileContent = [
            '---',
            `source: feishu`,
            `type: link`,
            `url: ${url}`,
            `title: "${title.replace(/"/g, '\\"')}"`,
            `fetched: ${new Date(nowMs).toISOString()}`,
            '---',
            '',
            result.content,
            '',
          ].join('\n');
          const filePath = fileWriter.writeObject('feishu', 'link', { id, title, url }, fileContent);
          sqlite.prepare('UPDATE objects SET file_path = ? WHERE id = ?').run(filePath, id);
        } catch { /* file write non-critical */ }
      }

      fetched++;

      // Progress logging every 10 URLs
      if (i % 10 === 0) {
        logger.info(`Links progress: ${i}/${extracted} (${fetched} fetched, ${failed} failed)`);
      }

      // Rate limit: 500ms between requests
      await new Promise(r => setTimeout(r, 500));
    }
  } catch (err) {
    logger.error(`Link sync error: ${err}`);
  }

  logger.info('Link sync complete', { extracted, fetched, failed });
  return { extracted, fetched, failed };
}
