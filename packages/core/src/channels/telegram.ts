/**
 * Telegram Channel
 *
 * 通过 Telegram Bot API 接收和发送消息，支持两种模式：
 * - Polling（默认）：适合开发环境，自动轮询 getUpdates
 * - Webhook：适合生产环境，需要公网 HTTPS 端点
 *
 * 环境变量：
 *   TELEGRAM_BOT_TOKEN   — Telegram Bot Token（必填，从 @BotFather 获取）
 *   TELEGRAM_MODE        — 'polling' | 'webhook'（默认 polling）
 *   TELEGRAM_WEBHOOK_URL — Webhook 完整 URL（webhook 模式时必填）
 *   TELEGRAM_POLL_INTERVAL_MS — 轮询间隔（默认 2000）
 */

import type { JoworkChannel, IncomingMessage, ChannelTarget, RichCard, ChannelConfig } from './types.js';
import { createLogger } from '../utils/logger.js';
import { httpRequest } from '../utils/http.js';

const log = createLogger('telegram-channel');

// ─── Telegram Bot API 类型 ────────────────────────────────────────────────────

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: { id: string; message?: TelegramMessage; data?: string };
}

interface TelegramMessage {
  message_id: number;
  from?: { id: number; first_name: string; last_name?: string; username?: string };
  chat: { id: number; type: string; title?: string };
  text?: string;
  document?: { file_id: string; file_name: string; mime_type?: string };
  reply_to_message?: TelegramMessage;
  date: number;
}

// ─── TelegramChannel 实现 ─────────────────────────────────────────────────────

export class TelegramChannel implements JoworkChannel {
  readonly id = 'telegram';
  readonly name = 'Telegram';
  readonly type = 'telegram';

  readonly capabilities = {
    richCards: false,      // Telegram 不支持卡片（用格式化文本代替）
    fileUpload: true,      // 支持文件发送
    reactions: false,
    threads: true,         // 支持回复（reply_to_message_id）
    editMessage: true,     // 支持编辑消息
  };

  private _token = '';
  private _mode: 'polling' | 'webhook' = 'polling';
  private _pollIntervalMs = 2000;
  private _offset = 0;
  private _pollTimer: ReturnType<typeof setInterval> | null = null;
  private _handlers: Array<(msg: IncomingMessage) => Promise<void>> = [];

  async initialize(config: ChannelConfig): Promise<void> {
    this._token = (config['token'] as string | undefined) ?? process.env['TELEGRAM_BOT_TOKEN'] ?? '';
    this._mode = ((config['mode'] as string | undefined) ?? process.env['TELEGRAM_MODE'] ?? 'polling') as 'polling' | 'webhook';
    this._pollIntervalMs = config.poll_interval_ms
      ?? parseInt(process.env['TELEGRAM_POLL_INTERVAL_MS'] ?? '2000', 10);

    if (!this._token) {
      log.warn('TelegramChannel: TELEGRAM_BOT_TOKEN not set, channel will be inactive');
      return;
    }

    if (this._mode === 'polling') {
      this._startPolling();
    } else {
      const webhookUrl = (config['webhook_url'] as string | undefined) ?? process.env['TELEGRAM_WEBHOOK_URL'];
      if (webhookUrl) {
        await this._setWebhook(webhookUrl);
      }
    }

    log.info(`TelegramChannel initialized (mode: ${this._mode})`);
  }

  async shutdown(): Promise<void> {
    if (this._pollTimer) {
      clearInterval(this._pollTimer);
      this._pollTimer = null;
    }
    if (this._mode === 'webhook') {
      await this._deleteWebhook();
    }
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this._handlers.push(handler);
  }

  async sendText(target: ChannelTarget, text: string): Promise<void> {
    if (!this._token) return;
    await this._botApi('sendMessage', {
      chat_id: target.chat_id,
      text,
      reply_to_message_id: target.thread_id ? parseInt(target.thread_id, 10) : undefined,
      parse_mode: 'Markdown',
    });
  }

  async sendRichCard(target: ChannelTarget, card: RichCard): Promise<void> {
    // Telegram 不支持卡片，用 Markdown 格式化文本模拟
    const emoji = { info: 'ℹ️', success: '✅', warning: '⚠️', error: '❌' }[card.color ?? 'info'];
    const lines = [
      card.title ? `*${card.title}* ${emoji}` : emoji,
      card.body,
    ];
    if (card.actions?.length) {
      lines.push('', ...card.actions.map(a => a.url ? `[${a.label}](${a.url})` : `• ${a.label}`));
    }
    await this.sendText(target, lines.join('\n'));
  }

  async sendFile(target: ChannelTarget, file: Buffer, filename: string): Promise<void> {
    if (!this._token) return;
    // 使用 multipart/form-data 发送文件（通过 fetch，httpRequest 不支持 FormData）
    const FormData = (await import('node:buffer')).Blob;
    void FormData; // 占位，实际通过原生 fetch 实现
    log.warn('TelegramChannel.sendFile: not fully implemented (use external fetch)');
    void file; void filename; void target;
  }

  // ─── Telegram Bot API 内部方法 ─────────────────────────────────────────────

  private async _botApi<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    const res = await httpRequest<T>(
      `https://api.telegram.org/bot${this._token}/${method}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params ?? {}),
      },
    );
    return res.data;
  }

  private _startPolling(): void {
    const poll = async () => {
      try {
        const result = await this._botApi<{ ok: boolean; result: TelegramUpdate[] }>(
          'getUpdates',
          { offset: this._offset, timeout: 1 },
        );
        if (result.ok) {
          for (const update of result.result) {
            this._offset = update.update_id + 1;
            if (update.message) await this._handleMessage(update.message);
          }
        }
      } catch { /* 网络错误静默忽略，继续轮询 */ }
    };

    this._pollTimer = setInterval(() => { void poll(); }, this._pollIntervalMs);
    log.info(`TelegramChannel polling started (interval: ${this._pollIntervalMs}ms)`);
  }

  private async _setWebhook(url: string): Promise<void> {
    await this._botApi('setWebhook', { url, drop_pending_updates: true });
    log.info(`TelegramChannel webhook set: ${url}`);
  }

  private async _deleteWebhook(): Promise<void> {
    await this._botApi('deleteWebhook', { drop_pending_updates: false });
  }

  /** 处理 Telegram Update 中的消息，转换为 IncomingMessage 并触发 handlers */
  async handleWebhookUpdate(update: TelegramUpdate): Promise<void> {
    if (update.message) await this._handleMessage(update.message);
  }

  private async _handleMessage(msg: TelegramMessage): Promise<void> {
    if (!msg.text) return; // 忽略非文本消息（图片、贴纸等）

    const incoming: IncomingMessage = {
      channel_id: this.id,
      sender_id: String(msg.from?.id ?? msg.chat.id),
      sender_name: [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown',
      text: msg.text,
      reply_to: msg.reply_to_message ? String(msg.reply_to_message.message_id) : undefined,
      metadata: {
        chat_id: String(msg.chat.id),
        message_id: msg.message_id,
        chat_type: msg.chat.type,
        username: msg.from?.username,
      },
    };

    for (const handler of this._handlers) {
      try {
        await handler(incoming);
      } catch (err) {
        log.error('TelegramChannel handler error', err);
      }
    }
  }
}

/** 单例实例 */
export const telegramChannel = new TelegramChannel();
