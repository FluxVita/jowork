// @jowork/core/channels/telegram — Telegram channel plugin (JoworkChannel impl)
//
// Sends/receives messages via the Telegram Bot API.
// Uses webhook mode (recommended for production) or long-polling (dev mode).
// Auth: Bot token from @BotFather.

import type {
  JoworkChannel,
  ChannelConfig,
  ChannelTarget,
  IncomingMessage,
  ChannelCapabilities,
} from './protocol.js';

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from?: { id: number; first_name: string; last_name?: string; username?: string };
    chat: { id: number; type: string };
    text?: string;
    caption?: string;
  };
}

interface TelegramSendMessageBody {
  chat_id: string | number;
  text: string;
  parse_mode?: string;
}

class TelegramChannel implements JoworkChannel {
  readonly id = 'telegram';
  readonly name = 'Telegram';
  readonly capabilities: ChannelCapabilities = {
    richCards:   false,
    fileUpload:  true,
    reactions:   false,
    threads:     false,
    editMessage: true,
  };

  private token         = '';
  private apiUrl        = 'https://api.telegram.org';
  private handler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private pollOffset    = 0;
  private pollTimer:    ReturnType<typeof setInterval> | null = null;

  async initialize(config: ChannelConfig): Promise<void> {
    this.token = (config['botToken'] as string) ?? '';
    if (!this.token) throw new Error('Telegram botToken is required');

    // If webhook URL provided, set it; otherwise start long-polling
    const webhookUrl = config['webhookUrl'] as string | undefined;
    if (webhookUrl) {
      await this.setWebhook(webhookUrl);
    } else {
      // Dev mode: long-polling every 2s
      this.startLongPolling();
    }
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.token = '';
    this.handler = null;
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async sendText(target: ChannelTarget, text: string): Promise<void> {
    const body: TelegramSendMessageBody = { chat_id: target.id, text };
    const res = await this.callApi('sendMessage', body);
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram sendMessage error: ${err}`);
    }
  }

  // ── Webhook entry point (call from Express route) ─────────────────────────

  /** Process a raw Telegram update (from webhook POST body) */
  async handleWebhookUpdate(update: TelegramUpdate): Promise<void> {
    const msg = update.message;
    if (!msg || !this.handler) return;

    const incoming: IncomingMessage = {
      channelId:   this.id,
      senderId:    String(msg.from?.id ?? msg.chat.id),
      senderName:  [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ') || 'Unknown',
      text:        msg.text ?? msg.caption ?? '',
    };

    await this.handler(incoming);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private startLongPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.poll();
    }, 2000);
  }

  private async poll(): Promise<void> {
    if (!this.handler) return;
    try {
      const res = await this.callApi('getUpdates', {
        offset: this.pollOffset,
        timeout: 1,
        allowed_updates: ['message'],
      });
      if (!res.ok) return;

      const data = await res.json() as { ok: boolean; result: TelegramUpdate[] };
      for (const update of data.result) {
        this.pollOffset = update.update_id + 1;
        await this.handleWebhookUpdate(update).catch(() => { /* non-fatal */ });
      }
    } catch {
      // Network errors during poll are non-fatal
    }
  }

  private async setWebhook(url: string): Promise<void> {
    await this.callApi('setWebhook', { url });
  }

  private callApi(method: string, body: unknown): Promise<Response> {
    return fetch(`${this.apiUrl}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }
}

/** Singleton Telegram channel — register with registerChannelPlugin() */
export const telegramChannel = new TelegramChannel();
