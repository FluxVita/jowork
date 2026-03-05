/**
 * 飞书 Channel — 将 Agent 回复通过飞书 API 发送。
 *
 * 复用 feishu/ws.ts 的 WebSocket 连接接收消息，
 * 通过飞书 Open API 回复消息。
 */

import { getLarkClient } from '../connectors/feishu/ws.js';
import { trackApiCall } from '../quota/manager.js';
import { createLogger } from '../utils/logger.js';
import type { Channel } from './types.js';

const log = createLogger('feishu-channel');

const MAX_MSG_LENGTH = 4000; // 飞书单条消息最长约 4096 字符，留余量

export class FeishuChannel implements Channel {
  id = 'feishu';
  type = 'feishu' as const;

  private chatId: string;

  constructor(chatId: string) {
    this.chatId = chatId;
  }

  async sendText(_sessionId: string, text: string): Promise<void> {
    const client = getLarkClient();
    if (!client) {
      log.warn('Lark client not available, cannot send message');
      return;
    }

    // 分段发送超长消息
    const segments = splitMessage(text, MAX_MSG_LENGTH);
    for (const segment of segments) {
      try {
        await client.im.v1.message.create({
          params: { receive_id_type: 'chat_id' },
          data: {
            receive_id: this.chatId,
            content: JSON.stringify({ text: segment }),
            msg_type: 'text',
          },
        });
        trackApiCall('feishu', 'bot_reply');
      } catch (err) {
        log.error(`Failed to send message to chat ${this.chatId}`, String(err));
      }
    }
  }

  async sendTyping(_sessionId: string): Promise<void> {
    // 飞书不支持 typing indicator，忽略
  }

  async sendError(_sessionId: string, error: string): Promise<void> {
    await this.sendText(_sessionId, `处理出错: ${error}`);
  }
}

/** 按最大长度分段，尽量在换行符处断开 */
function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];

  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      segments.push(remaining);
      break;
    }

    // 在 maxLen 内找最后一个换行
    let splitIdx = remaining.lastIndexOf('\n', maxLen);
    if (splitIdx < maxLen * 0.5) {
      // 换行太靠前，直接硬切
      splitIdx = maxLen;
    }

    segments.push(remaining.slice(0, splitIdx));
    remaining = remaining.slice(splitIdx).replace(/^\n/, '');
  }

  return segments;
}
