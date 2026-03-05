/**
 * list_chat_messages.ts
 * 列出最近群聊消息（无需关键词，按时间倒序）
 */
import type { Tool, ToolContext } from '../types.js';
import { getDb } from '../../datamap/db.js';
import { getUserGroups } from '../../services/feishu-groups.js';

export const listChatMessagesTool: Tool = {
  name: 'list_chat_messages',
  description: '列出飞书群聊的最近消息（按时间倒序）。用于"最近群里有什么消息"、"群里最新动态"等不需要搜索关键词的场景。直接读取本地已同步数据，无需飞书授权。',
  input_schema: {
    type: 'object',
    properties: {
      chat_id: {
        type: 'string',
        description: '指定群 chat_id（可选），不填则返回所有群的最近消息',
      },
      limit: {
        type: 'number',
        description: '返回条数，默认 20，最大 50',
      },
    },
    required: [],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const db = getDb();
    const limit = Math.min((input['limit'] as number) ?? 20, 50);
    const chatId = input['chat_id'] as string | undefined;

    // 权限过滤：只返回用户所在群的消息
    const userGroups = getUserGroups(ctx.user_id);
    const allowedChatIds = userGroups.map((g: { group_id: string }) => g.group_id);

    // 管理员或无群组限制时允许查所有
    const hasGroupLimit = allowedChatIds.length > 0;

    let sql: string;
    let params: unknown[];

    if (chatId) {
      if (hasGroupLimit && !allowedChatIds.includes(chatId)) {
        return '你没有权限查看该群的消息。';
      }
      sql = `SELECT message_id, chat_id, sender_name, sender_id, msg_type, content_text, created_at
             FROM chat_messages
             WHERE chat_id = ? AND msg_type != 'system'
             ORDER BY created_at DESC LIMIT ?`;
      params = [chatId, limit];
    } else if (hasGroupLimit) {
      const placeholders = allowedChatIds.map(() => '?').join(',');
      sql = `SELECT message_id, chat_id, sender_name, sender_id, msg_type, content_text, created_at
             FROM chat_messages
             WHERE chat_id IN (${placeholders}) AND msg_type != 'system'
             ORDER BY created_at DESC LIMIT ?`;
      params = [...allowedChatIds, limit];
    } else {
      sql = `SELECT message_id, chat_id, sender_name, sender_id, msg_type, content_text, created_at
             FROM chat_messages
             WHERE msg_type != 'system'
             ORDER BY created_at DESC LIMIT ?`;
      params = [limit];
    }

    const rows = db.prepare(sql).all(...params) as {
      message_id: string;
      chat_id: string;
      sender_name: string;
      sender_id: string;
      msg_type: string;
      content_text: string;
      created_at: string;
    }[];

    if (rows.length === 0) {
      return '暂无群聊消息记录。Bot 可能尚未同步消息，或尚未被添加到群聊中。';
    }

    const lines = rows.map(r => {
      const time = r.created_at?.slice(0, 16).replace('T', ' ') ?? '';
      const sender = r.sender_name || r.sender_id || '未知';
      const text = r.content_text.slice(0, 200).replace(/\n/g, ' ');
      return `[${time}] ${sender}: ${text}`;
    });

    return `最近 ${rows.length} 条群聊消息：\n\n${lines.join('\n')}`;
  },
};
