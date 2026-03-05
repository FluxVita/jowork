import * as Lark from '@larksuiteoapi/node-sdk';
import { createHash } from 'node:crypto';
import { config } from '../../config.js';
import { cacheInvalidate } from '../base.js';
import { upsertObject, searchObjects } from '../../datamap/objects.js';
import { trackApiCall } from '../../quota/manager.js';
import { getUserByFeishuId } from '../../auth/users.js';
import { agentChat } from '../../agent/controller.js';
import { createFeishuChannel } from '../../channels/registry.js';
import { getDb } from '../../datamap/db.js';
import { logAudit } from '../../audit/logger.js';
import { handleChatMessage } from './chat-sync.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('feishu-ws');

let wsClient: InstanceType<typeof Lark.WSClient> | null = null;
let larkClient: InstanceType<typeof Lark.Client> | null = null;

/** 获取飞书 API Client（供其他模块使用） */
export function getLarkClient(): InstanceType<typeof Lark.Client> | null {
  return larkClient;
}

/** 启动飞书 WebSocket 长链接 */
export async function startFeishuWS() {
  const { app_id, app_secret } = config.feishu;

  if (!app_id || !app_secret) {
    log.warn('Feishu app_id/app_secret not configured, skipping WS connection');
    return;
  }

  const baseConfig = { appId: app_id, appSecret: app_secret };

  // 创建 HTTP Client（用于在事件处理中调用 API）
  larkClient = new Lark.Client(baseConfig);

  // 确保 session 映射表存在
  ensureFeishuSessionTable();

  // 创建事件分发器
  const eventDispatcher = new Lark.EventDispatcher({});

  // 注册事件处理器
  eventDispatcher.register({
    // ─── 群消息事件 ───
    'im.message.receive_v1': async (data: Record<string, unknown>) => {
      try {
        await handleMessage(data);
      } catch (err) {
        log.error('Message event handler failed', err);
      }
    },

    // ─── 文档变更事件 ───
    'drive.file.edit_v1': async (data: Record<string, unknown>) => {
      try {
        await handleFileChange(data);
      } catch (err) {
        log.error('File edit event handler failed', err);
      }
    },

    'drive.file.title_updated_v1': async (data: Record<string, unknown>) => {
      try {
        await handleFileChange(data);
      } catch (err) {
        log.error('File title update event handler failed', err);
      }
    },
  });

  // 创建 WebSocket Client 并启动
  wsClient = new Lark.WSClient({
    ...baseConfig,
    loggerLevel: Lark.LoggerLevel.info,
  });

  try {
    await wsClient.start({ eventDispatcher });
    log.info('Feishu WebSocket long connection established');
  } catch (err) {
    log.error('Feishu WebSocket connection failed', err);
  }
}

/** 停止飞书长链接 */
export function stopFeishuWS() {
  if (wsClient) {
    wsClient.close();
    wsClient = null;
    log.info('Feishu WebSocket connection closed');
  }
}

// ─── 飞书 Chat → Agent Session 映射 ───

function ensureFeishuSessionTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS feishu_sessions (
      chat_id TEXT NOT NULL,
      user_open_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (chat_id, user_open_id)
    )
  `);
}

function getFeishuSession(chatId: string, userOpenId: string): string | null {
  const db = getDb();
  const row = db.prepare(
    'SELECT session_id FROM feishu_sessions WHERE chat_id = ? AND user_open_id = ?'
  ).get(chatId, userOpenId) as { session_id: string } | undefined;
  return row?.session_id ?? null;
}

function setFeishuSession(chatId: string, userOpenId: string, sessionId: string): void {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO feishu_sessions (chat_id, user_open_id, session_id)
    VALUES (?, ?, ?)
  `).run(chatId, userOpenId, sessionId);
}

// ─── 事件处理 ───

/** 处理消息事件 */
async function handleMessage(data: Record<string, unknown>) {
  // 所有消息先入库到 chat_messages（全量记录）
  handleChatMessage(data).catch(err => {
    log.error('Chat message persistence failed', err);
  });

  const event = data as {
    sender: { sender_id: { open_id: string }; sender_type: string };
    message: {
      message_id: string;
      chat_id: string;
      chat_type: string;
      message_type: string;
      content: string;
      mentions?: { key: string; id: { open_id: string }; name: string }[];
    };
  };

  const msg = event.message;
  const sender = event.sender;

  log.info(`Message received: ${msg.chat_type} from ${sender.sender_id.open_id}`);

  // @mention-gating：群聊中必须被 @bot 才处理
  if (msg.chat_type === 'group') {
    const botOpenId = config.feishu.bot_open_id;
    const isMentioned = msg.mentions?.some(m => m.id.open_id === botOpenId);
    if (!isMentioned) {
      return; // 群聊未 @bot，忽略
    }
    log.info('Bot mentioned in group, processing...');
  }

  // 解析文本消息
  if (msg.message_type === 'text') {
    try {
      const content = JSON.parse(msg.content);
      let text = content.text as string;

      // 去掉 @bot 的 mention 占位符
      if (msg.mentions) {
        for (const m of msg.mentions) {
          text = text.replace(m.key, '').trim();
        }
      }

      // 自动索引飞书文档链接
      const docLinks = text.match(/https:\/\/\S*\.feishu\.cn\/\S+/g);
      if (docLinks) {
        for (const link of docLinks) {
          indexFeishuLink(link);
        }
      }

      // 通过 Agent 处理查询（带 session 持久化）
      if (text.length > 0) {
        const isGroup = msg.chat_type === 'group';
        await processQueryViaAgent(text, sender.sender_id.open_id, msg.chat_id, isGroup);
      }
    } catch (err) {
      log.error('Failed to parse message content', err);
      // 回复错误信息
      if (larkClient) {
        await larkClient.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: msg.chat_id,
            content: JSON.stringify({ text: '处理消息时出错，请稍后重试' }),
            msg_type: 'text',
          },
        });
        trackApiCall('feishu', 'bot_reply');
      }
    }
  }

  trackApiCall('feishu', 'event_receive', 0); // 事件接收不算调用
}

/** 通过 Agent 处理飞书查询（带 session 持久化） */
async function processQueryViaAgent(query: string, senderOpenId: string, chatId: string, isGroupChat = false) {
  // 解析用户身份
  const user = getUserByFeishuId(senderOpenId);
  const userId = user?.user_id ?? senderOpenId;
  const userRole = user?.role ?? 'guest';

  // 获取或创建飞书 Channel
  const channel = createFeishuChannel(chatId);

  // 查找已有 session（飞书 chat_id + user → agent session_id）
  let sessionId = getFeishuSession(chatId, senderOpenId);

  log.info(`Processing via Agent: user=${userId}, session=${sessionId ?? 'new'}`);

  try {
    const stream = agentChat({
      userId,
      role: userRole,
      sessionId: sessionId ?? undefined,
      message: query,
      channel,
      isGroupChat,
    });

    let finalContent = '';
    let newSessionId: string | null = null;

    for await (const event of stream) {
      if (event.event === 'session_created') {
        newSessionId = event.data.session_id;
      } else if (event.event === 'text_done') {
        finalContent = event.data.content;
      }
    }

    // 保存 session 映射
    if (newSessionId) {
      setFeishuSession(chatId, senderOpenId, newSessionId);
      sessionId = newSessionId;
    }

    // 通过飞书 Channel 发送最终回复
    if (finalContent) {
      await channel.sendText(sessionId ?? '', finalContent);
    }

    // 审计日志
    logAudit({
      actor_id: userId,
      actor_role: userRole,
      channel: 'feishu',
      action: 'agent_chat',
      result: 'allowed',
      matched_rule: `feishu_agent:${chatId}`,
    });

    log.info(`Agent query processed via Feishu Channel: "${query.slice(0, 50)}"`);
  } catch (err) {
    log.error('Agent processing failed for Feishu query', err);
    await channel.sendError('', `Agent 处理失败: ${String(err).slice(0, 200)}`);
  }
}

/** 处理文档变更事件 */
async function handleFileChange(data: Record<string, unknown>) {
  const fileToken = (data as { file_token?: string }).file_token;
  if (!fileToken) return;

  // 使所有可能的缓存失效
  cacheInvalidate(`lark://wiki/${fileToken}`);
  cacheInvalidate(`lark://doc/${fileToken}`);
  cacheInvalidate(`lark://docx/${fileToken}`);
  log.info(`Cache invalidated for file change: ${fileToken}`);
}

/** 自动索引飞书文档链接 */
function indexFeishuLink(link: string) {
  const now = new Date().toISOString();
  const hash = createHash('md5').update(link).digest('hex').slice(0, 12);

  upsertObject({
    source: 'feishu',
    source_type: 'document',
    uri: `lark://link/${hash}`,
    external_url: link,
    title: '(Auto-indexed from chat)',
    sensitivity: 'internal',
    acl: { read: ['role:all_staff'] },
    tags: ['auto-indexed', 'chat-link'],
    updated_at: now,
    ttl_seconds: 900,
    connector_id: 'feishu_v1',
  });

  log.debug(`Auto-indexed link: ${link}`);
}
