import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { getDb } from '../../datamap/db.js';
import { saveContent } from '../../datamap/content-store.js';
import { feishuApi, getTenantToken } from './auth.js';
import { trackApiCall, canCallFeishu } from '../../quota/manager.js';
import { getCursor, setCursor } from '../sync-state.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const ATTACH_ROOT = join(dirname(config.db_path), 'content', 'feishu_attach');

const log = createLogger('feishu-chat-sync');

// ─── 类型定义 ───

interface FeishuMessage {
  message_id: string;
  root_id?: string;
  parent_id?: string;
  msg_type: string;
  body: { content: string };
  sender: { id: string; sender_type: string; id_type?: string };
  chat_id: string;
  create_time: string;
  update_time?: string;
}

interface FeishuChatInfo {
  chat_id: string;
  name: string;
  chat_mode: string;  // 'group' | 'topic_group'
  owner_id?: string;
}

interface FeishuListResp<T> {
  code: number;
  msg: string;
  data: {
    items: T[];
    has_more: boolean;
    page_token?: string;
  };
}

// ─── 消息解析 ───

/** 解析飞书消息内容为纯文本 */
function parseMessageContent(msgType: string, contentJson: string): string {
  try {
    const content = JSON.parse(contentJson);

    switch (msgType) {
      case 'text':
        return content.text || '';

      case 'post': {
        // 富文本：遍历所有段落提取文字
        const lines: string[] = [];
        const zhContent = content.zh_cn || content.en_us || content;
        if (zhContent?.title) lines.push(`**${zhContent.title}**`);
        if (zhContent?.content) {
          for (const paragraph of zhContent.content) {
            const parts: string[] = [];
            for (const element of paragraph) {
              if (element.tag === 'text') parts.push(element.text || '');
              else if (element.tag === 'a') parts.push(`[${element.text || ''}](${element.href || ''})`);
              else if (element.tag === 'at') parts.push(`@${element.user_name || element.user_id || ''}`);
              else if (element.tag === 'img') parts.push('[图片]');
              else if (element.tag === 'media') parts.push('[视频/文件]');
            }
            lines.push(parts.join(''));
          }
        }
        return lines.join('\n');
      }

      case 'interactive':
        // 卡片消息：提取关键文本
        if (content.elements) {
          return content.elements
            .filter((el: { tag: string }) => el.tag === 'markdown' || el.tag === 'div')
            .map((el: { content?: string; text?: { content?: string } }) => el.content || el.text?.content || '')
            .join('\n');
        }
        return '[卡片消息]';

      case 'image':
        return '[图片]';
      case 'file':
        return `[文件: ${content.file_name || ''}]`;
      case 'audio':
        return '[语音]';
      case 'video':
        return '[视频]';
      case 'sticker':
        return '[表情]';
      case 'share_chat':
        return `[群名片: ${content.chat_id || ''}]`;
      case 'share_user':
        return `[个人名片: ${content.user_id || ''}]`;
      default:
        return `[${msgType}]`;
    }
  } catch {
    return contentJson || '';
  }
}

/** 提取飞书文档链接 */
function extractDocLinks(text: string): { token: string; type: string; url: string }[] {
  const links: { token: string; type: string; url: string }[] = [];
  // 匹配飞书文档 URL
  const pattern = /https:\/\/\S*\.feishu\.cn\/(docx|doc|wiki|sheets|bitable|mindnotes|slides)\/(\S+?)(?:\s|$|[)}\]>])/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    links.push({
      type: match[1],
      token: match[2].replace(/[?#].*$/, ''), // 去掉 query/hash
      url: match[0].trim(),
    });
  }
  return links;
}

/** 从消息 JSON 提取附件信息（image/file/audio/video/sticker） */
function extractAttachments(msgType: string, contentJson: string): {
  file_key: string; file_name?: string; file_size?: number; content_type?: string;
}[] {
  try {
    const content = JSON.parse(contentJson);
    switch (msgType) {
      case 'image':
        return content.image_key ? [{ file_key: content.image_key, content_type: 'image/jpeg' }] : [];
      case 'file':
        return content.file_key ? [{
          file_key: content.file_key,
          file_name: content.file_name,
          file_size: content.file_size,
        }] : [];
      case 'audio':
        return content.file_key ? [{ file_key: content.file_key, content_type: 'audio/mpeg' }] : [];
      case 'video':
        return content.file_key
          ? [{ file_key: content.file_key, file_name: content.file_name, content_type: 'video/mp4' }]
          : content.image_key ? [{ file_key: content.image_key, content_type: 'image/jpeg' }] : [];
      default:
        return [];
    }
  } catch {
    return [];
  }
}

// ─── 数据库操作 ───

/** 插入消息（忽略重复） */
function insertMessage(msg: {
  message_id: string;
  chat_id: string;
  chat_type: string;
  sender_id: string;
  sender_name: string;
  msg_type: string;
  content_text: string;
  content_json: string;
  parent_id: string | null;
  doc_links_json: string | null;
  created_at: string;
}): boolean {
  const db = getDb();
  try {
    db.prepare(`
      INSERT OR IGNORE INTO chat_messages
        (message_id, chat_id, chat_type, sender_id, sender_name, msg_type,
         content_text, content_json, parent_id, doc_links_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.message_id, msg.chat_id, msg.chat_type, msg.sender_id, msg.sender_name,
      msg.msg_type, msg.content_text, msg.content_json, msg.parent_id,
      msg.doc_links_json, msg.created_at,
    );

    // 同步 FTS
    const row = db.prepare('SELECT id FROM chat_messages WHERE message_id = ?').get(msg.message_id) as { id: number } | undefined;
    if (row) {
      db.prepare('DELETE FROM chat_fts WHERE rowid = ?').run(row.id);
      db.prepare('INSERT INTO chat_fts(rowid, sender_name, content_text) VALUES (?, ?, ?)').run(
        row.id, msg.sender_name, msg.content_text,
      );
    }

    return true;
  } catch {
    return false; // 重复消息
  }
}

/** 插入附件元数据 */
function insertAttachment(attachment: {
  message_id: string;
  file_key: string;
  file_name?: string;
  file_size?: number;
  content_type?: string;
}): void {
  const db = getDb();
  db.prepare(`
    INSERT OR IGNORE INTO chat_attachments (message_id, file_key, file_name, file_size, content_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    attachment.message_id, attachment.file_key,
    attachment.file_name ?? null, attachment.file_size ?? null,
    attachment.content_type ?? null,
  );
}

// ─── 实时同步（WebSocket 事件） ───

/** 处理单条消息事件（WebSocket im.message.receive_v1 调用） */
export async function handleChatMessage(eventData: Record<string, unknown>): Promise<void> {
  const message = eventData['message'] as Record<string, unknown>;
  if (!message) return;

  const messageId = message['message_id'] as string;
  const chatId = message['chat_id'] as string;
  const chatType = (message['chat_type'] as string) === 'p2p' ? 'p2p' : 'group';
  const msgType = message['message_type'] as string;
  const contentStr = message['content'] as string || '{}';
  const parentId = message['parent_id'] as string | null || null;

  const sender = eventData['sender'] as Record<string, unknown>;
  const senderId = (sender?.['sender_id'] as Record<string, string>)?.['open_id'] || '';
  const senderType = sender?.['sender_type'] as string || '';

  // 跳过 Bot 自己的消息
  if (senderType === 'app') return;

  // 解析内容
  const contentText = parseMessageContent(msgType, contentStr);

  // 提取文档链接
  const docLinks = extractDocLinks(contentText);

  // 提取附件元数据
  const attachments = extractAttachments(msgType, contentStr);

  // 获取发送者名称（异步获取，降级为 ID）
  let senderName = senderId;
  try {
    if (canCallFeishu('user_info')) {
      const userResp = await feishuApi<{
        code: number; data: { user: { name: string } };
      }>(`/contact/v3/users/${senderId}`, {
        params: { user_id_type: 'open_id' },
      });
      if (userResp.code === 0 && userResp.data?.user?.name) {
        senderName = userResp.data.user.name;
      }
      trackApiCall('feishu', 'user_info');
    }
  } catch { /* 降级使用 ID */ }

  const created = message['create_time'] as string;
  const createdAt = created
    ? new Date(parseInt(created)).toISOString()
    : new Date().toISOString();

  const inserted = insertMessage({
    message_id: messageId,
    chat_id: chatId,
    chat_type: chatType,
    sender_id: senderId,
    sender_name: senderName,
    msg_type: msgType,
    content_text: contentText,
    content_json: contentStr,
    parent_id: parentId,
    doc_links_json: docLinks.length > 0 ? JSON.stringify(docLinks) : null,
    created_at: createdAt,
  });

  if (inserted) {
    log.debug(`Chat message saved: ${messageId} in ${chatId}`);

    // 存附件元数据 + 异步下载
    for (const att of attachments) {
      insertAttachment({ message_id: messageId, ...att });
      downloadAttachment(messageId, att.file_key, att.content_type).catch(err =>
        log.debug(`Failed to download attachment ${att.file_key}`, err)
      );
    }

    // 文档链接异步下载全文
    for (const link of docLinks) {
      downloadDocContent(link.token, link.type).catch(err =>
        log.debug(`Failed to download doc from chat link: ${link.token}`, err)
      );
    }
  }
}

/** 异步下载飞书文档全文 */
async function downloadDocContent(token: string, type: string): Promise<void> {
  if (!canCallFeishu('doc_fetch')) return;

  try {
    const resp = await feishuApi<{
      code: number; msg: string; data: { content: string };
    }>(`/docx/v1/documents/${token}/raw_content`, {
      params: { lang: '0' },
    });
    trackApiCall('feishu', 'doc_fetch');

    if (resp.code === 0 && resp.data?.content) {
      saveContent('feishu_doc', `chat_link_${token}`, resp.data.content);
      log.debug(`Downloaded doc content from chat link: ${token}`);
    }
  } catch (err) {
    log.debug(`Failed to download doc ${token}`, err);
  }
}

/** 下载单个附件文件到本地（image/file/audio/video） */
async function downloadAttachment(messageId: string, fileKey: string, contentType?: string): Promise<void> {
  if (!canCallFeishu('doc_fetch')) return;

  const db = getDb();
  // 已下载则跳过
  const row = db.prepare('SELECT downloaded, local_path FROM chat_attachments WHERE file_key = ?').get(fileKey) as
    { downloaded: number; local_path: string | null } | undefined;
  if (!row || row.downloaded === 1) return;

  try {
    const url = `https://open.feishu.cn/open-apis/im/v1/messages/${messageId}/resources/${fileKey}?type=file`;
    const token = await getTenantToken();
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    trackApiCall('feishu', 'doc_fetch');

    if (!resp.ok) {
      log.debug(`Attachment download failed ${fileKey}: HTTP ${resp.status}`);
      return;
    }

    // 推断扩展名
    const mime = resp.headers.get('content-type') || contentType || 'application/octet-stream';
    const extMap: Record<string, string> = {
      'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
      'audio/mpeg': '.mp3', 'audio/ogg': '.ogg',
      'video/mp4': '.mp4',
      'application/pdf': '.pdf',
    };
    const ext = extMap[mime.split(';')[0].trim()] ?? extname(fileKey) ?? '';
    const localPath = join(ATTACH_ROOT, `${fileKey}${ext}`);

    mkdirSync(ATTACH_ROOT, { recursive: true });
    const buf = Buffer.from(await resp.arrayBuffer());
    writeFileSync(localPath, buf);

    db.prepare('UPDATE chat_attachments SET downloaded = 1, local_path = ? WHERE file_key = ?')
      .run(localPath, fileKey);

    log.debug(`Attachment saved: ${fileKey} → ${localPath} (${buf.length} bytes)`);
  } catch (err) {
    log.debug(`Failed to download attachment ${fileKey}`, err);
  }
}

/** 下载所有未下载的附件（Cron 调用，每次最多处理 50 条） */
export async function downloadPendingAttachments(): Promise<number> {
  const db = getDb();
  const pending = db.prepare(`
    SELECT ca.message_id, ca.file_key, ca.content_type
    FROM chat_attachments ca
    WHERE ca.downloaded = 0
    ORDER BY ca.created_at DESC
    LIMIT 50
  `).all() as { message_id: string; file_key: string; content_type: string | null }[];

  if (!pending.length) return 0;

  log.info(`Downloading ${pending.length} pending attachments...`);
  let count = 0;
  for (const row of pending) {
    const localPath = join(ATTACH_ROOT, row.file_key);
    if (existsSync(localPath + '.jpg') || existsSync(localPath + '.png') || existsSync(localPath + '.pdf')) {
      // 已存在则只更新标记
      db.prepare('UPDATE chat_attachments SET downloaded = 1 WHERE file_key = ?').run(row.file_key);
      count++;
      continue;
    }
    await downloadAttachment(row.message_id, row.file_key, row.content_type ?? undefined);
    count++;
  }
  log.info(`Attachment download complete: ${count} processed`);
  return count;
}

// ─── 批量同步（Cron 任务） ───

/** 批量同步 Bot 所在群的历史消息（Cron 调用） */
export async function syncChatMessages(): Promise<{ total: number; groups: number }> {
  log.info('Starting chat message batch sync...');

  let totalMessages = 0;
  let groupCount = 0;

  try {
    // 获取 Bot 所在的群列表
    const chats = await getBotChats();
    groupCount = chats.length;
    log.info(`Found ${chats.length} chats to sync`);

    for (const chat of chats) {
      try {
        const count = await syncSingleChat(chat.chat_id, chat.chat_mode);
        totalMessages += count;
      } catch (err) {
        log.error(`Failed to sync chat ${chat.name} (${chat.chat_id})`, err);
      }
    }
  } catch (err) {
    log.error('Chat message batch sync failed', err);
  }

  log.info(`Chat sync complete: ${totalMessages} messages from ${groupCount} groups`);
  return { total: totalMessages, groups: groupCount };
}

/** 获取 Bot 加入的群列表 */
async function getBotChats(): Promise<FeishuChatInfo[]> {
  if (!canCallFeishu('chat_list')) return [];

  const chats: FeishuChatInfo[] = [];
  let pageToken: string | undefined;

  do {
    const params: Record<string, string> = { page_size: '50' };
    if (pageToken) params['page_token'] = pageToken;

    const resp = await feishuApi<FeishuListResp<FeishuChatInfo>>(
      '/im/v1/chats',
      { params },
    );
    trackApiCall('feishu', 'chat_list');

    if (resp.code !== 0 || !resp.data?.items) break;

    chats.push(...resp.data.items);
    pageToken = resp.data.has_more ? resp.data.page_token : undefined;
  } while (pageToken);

  return chats;
}

/** 同步单个群的消息（增量） */
async function syncSingleChat(chatId: string, chatMode: string): Promise<number> {
  // 读取上次同步的时间戳 cursor
  const cursorKey = `chat_sync_${chatId}`;
  const lastSyncTs = getCursor('feishu_chat', cursorKey);

  // 飞书 API start_time/end_time 使用秒级 Unix 时间戳
  const startTime = lastSyncTs || String(Math.floor((Date.now() - 30 * 86400_000) / 1000));

  const chatType = chatMode === 'topic_group' ? 'topic' : 'group';
  let count = 0;
  let pageToken: string | undefined;
  let latestTs = startTime;

  do {
    if (!canCallFeishu('chat_history')) break;

    const params: Record<string, string> = {
      container_id_type: 'chat',
      container_id: chatId,
      start_time: startTime,
      end_time: String(Math.floor(Date.now() / 1000)),
      page_size: '50',
      sort_type: 'ByCreateTimeAsc',
    };
    if (pageToken) params['page_token'] = pageToken;

    const resp = await feishuApi<FeishuListResp<FeishuMessage>>(
      '/im/v1/messages',
      { params },
    );
    trackApiCall('feishu', 'chat_history');

    if (resp.code !== 0 || !resp.data?.items) break;

    for (const msg of resp.data.items) {
      // 跳过 Bot 消息
      if (msg.sender.sender_type === 'app') continue;

      const contentText = parseMessageContent(msg.msg_type, msg.body?.content || '{}');
      const docLinks = extractDocLinks(contentText);
      const attachments = extractAttachments(msg.msg_type, msg.body?.content || '{}');

      const createdAt = msg.create_time
        ? new Date(parseInt(msg.create_time)).toISOString()
        : new Date().toISOString();

      const inserted = insertMessage({
        message_id: msg.message_id,
        chat_id: chatId,
        chat_type: chatType,
        sender_id: msg.sender.id,
        sender_name: msg.sender.id, // 批量模式用 ID，不逐条查名字
        msg_type: msg.msg_type,
        content_text: contentText,
        content_json: msg.body?.content || '{}',
        parent_id: msg.parent_id || null,
        doc_links_json: docLinks.length > 0 ? JSON.stringify(docLinks) : null,
        created_at: createdAt,
      });

      if (inserted) {
        count++;
        // 存附件元数据（批量模式不立即下载，交给 downloadPendingAttachments Cron）
        for (const att of attachments) {
          insertAttachment({ message_id: msg.message_id, ...att });
        }
      }

      // 记录最新时间戳（转为秒级，与 API start_time 参数对齐）
      if (msg.create_time && msg.create_time > latestTs) {
        latestTs = String(Math.floor(parseInt(msg.create_time) / 1000));
      }
    }

    pageToken = resp.data.has_more ? resp.data.page_token : undefined;
  } while (pageToken);

  // 更新 cursor
  if (count > 0) {
    setCursor('feishu_chat', cursorKey, latestTs);
  }

  if (count > 0) {
    log.info(`Synced ${count} messages from chat ${chatId}`);
  }

  return count;
}

// ─── 统计 ───

/** 获取群消息统计信息 */
export function getChatStats(): {
  total_messages: number;
  total_chats: number;
  latest_sync: string | null;
} {
  const db = getDb();
  const total = (db.prepare('SELECT COUNT(*) as n FROM chat_messages').get() as { n: number }).n;
  const chats = (db.prepare('SELECT COUNT(DISTINCT chat_id) as n FROM chat_messages').get() as { n: number }).n;
  const latest = db.prepare('SELECT MAX(synced_at) as t FROM chat_messages').get() as { t: string | null };

  return {
    total_messages: total,
    total_chats: chats,
    latest_sync: latest?.t ?? null,
  };
}
