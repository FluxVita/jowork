// @jowork/core/channels/discord — Discord channel plugin (JoworkChannel impl)
//
// Supports two modes:
//   Webhook mode  — send-only; user provides a Discord webhook URL.
//                   No bot token required. Rich embeds supported.
//   Bot mode      — send + receive; user provides a Bot token.
//                   Uses Discord HTTP API for sending and long-polling
//                   (GET /channels/:id/messages) for receiving (simplified).
//                   For production receiving, upgrade to Gateway WebSocket.
//
// Config keys:
//   webhookUrl  — Discord Incoming Webhook URL (webhook mode)
//   botToken    — Bot token from Discord Developer Portal (bot mode)
//   channelId   — Default channel ID (required for bot mode sending)

import type {
  JoworkChannel,
  ChannelConfig,
  ChannelTarget,
  IncomingMessage,
  RichCard,
  ChannelCapabilities,
} from './protocol.js';

const DISCORD_API = 'https://discord.com/api/v10';

// ─── Minimal Discord REST types ────────────────────────────────────────────────

interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
}

interface DiscordMessage {
  id: string;
  content: string;
  author: { id: string; username: string; bot?: boolean };
  channel_id: string;
  timestamp: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a hex color string (#rrggbb) or CSS color name to Discord integer. */
function colorToInt(color: string | undefined): number | undefined {
  if (!color) return undefined;
  const hex = color.startsWith('#') ? color.slice(1) : undefined;
  if (hex && /^[0-9a-fA-F]{6}$/.test(hex)) {
    return parseInt(hex, 16);
  }
  // Fallback: blurple
  return 0x5865f2;
}

/** Build a Discord embed from a RichCard. */
function cardToEmbed(card: RichCard): DiscordEmbed {
  const embed: DiscordEmbed = {
    description: card.body,
  };
  if (card.title) embed.title = card.title;
  if (card.footer) embed.footer = { text: card.footer };
  const colorInt = colorToInt(card.color);
  if (colorInt !== undefined) embed.color = colorInt;
  if (card.fields) {
    embed.fields = card.fields.map(f => ({
      name: f.label,
      value: f.value,
      inline: f.inline ?? false,
    }));
  }
  return embed;
}

// ─── DiscordChannel ────────────────────────────────────────────────────────────

class DiscordChannel implements JoworkChannel {
  readonly id = 'discord';
  readonly name = 'Discord';
  readonly capabilities: ChannelCapabilities = {
    richCards:   true,   // Discord embeds
    fileUpload:  false,  // Planned; skipped for YAGNI
    reactions:   false,
    threads:     false,
    editMessage: false,  // Requires message ID tracking
  };

  private webhookUrl = '';
  private botToken   = '';
  private channelId  = '';
  private handler: ((msg: IncomingMessage) => Promise<void>) | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  /** Snowflake ID of the last seen message (for bot-mode polling). */
  private lastMessageId = '';

  async initialize(config: ChannelConfig): Promise<void> {
    this.webhookUrl = (config['webhookUrl'] as string) ?? '';
    this.botToken   = (config['botToken']   as string) ?? '';
    this.channelId  = (config['channelId']  as string) ?? '';

    if (!this.webhookUrl && !this.botToken) {
      throw new Error('Discord channel requires either webhookUrl or botToken');
    }

    if (this.botToken && this.channelId) {
      // Bot mode: start lightweight long-polling for incoming messages
      this.startPolling();
    }
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.handler = null;
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async sendText(target: ChannelTarget, text: string): Promise<void> {
    const cid = target.id || this.channelId;
    if (this.webhookUrl && (!cid || cid === this.channelId)) {
      await this.postWebhook({ content: text });
    } else {
      await this.botPost(`/channels/${cid}/messages`, { content: text });
    }
  }

  async sendRichCard(target: ChannelTarget, card: RichCard): Promise<void> {
    const cid = target.id || this.channelId;
    const embeds = [cardToEmbed(card)];
    if (this.webhookUrl && (!cid || cid === this.channelId)) {
      await this.postWebhook({ embeds });
    } else {
      await this.botPost(`/channels/${cid}/messages`, { embeds });
    }
  }

  // ── Webhook helpers ──────────────────────────────────────────────────────────

  private async postWebhook(body: object): Promise<void> {
    const res = await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Discord webhook error ${res.status}: ${text}`);
    }
  }

  // ── Bot REST helpers ─────────────────────────────────────────────────────────

  private async botPost(path: string, body: object): Promise<Response> {
    if (!this.botToken) throw new Error('Discord botToken required for bot API');
    return fetch(`${DISCORD_API}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bot ${this.botToken}`,
      },
      body: JSON.stringify(body),
    });
  }

  private async botGet(path: string, params?: Record<string, string>): Promise<Response> {
    if (!this.botToken) throw new Error('Discord botToken required for bot API');
    const url = new URL(`${DISCORD_API}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    return fetch(url.toString(), {
      headers: { 'authorization': `Bot ${this.botToken}` },
    });
  }

  // ── Long-polling (bot mode) ──────────────────────────────────────────────────
  //
  // Discord does not support traditional long-polling, but we can periodically
  // GET /channels/:id/messages?after=<lastId> to detect new messages.
  // For production, replace with Gateway WebSocket (discord.js or raw ws).

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.poll().catch(() => { /* non-fatal */ });
    }, 5000); // Every 5 seconds
  }

  private async poll(): Promise<void> {
    if (!this.handler || !this.channelId) return;

    const params: Record<string, string> = { limit: '10' };
    if (this.lastMessageId) params['after'] = this.lastMessageId;

    const res = await this.botGet(`/channels/${this.channelId}/messages`, params);
    if (!res.ok) return;

    const messages = await res.json() as DiscordMessage[];
    // Discord returns newest-first; reverse for chronological order
    const sorted = [...messages].reverse();

    for (const msg of sorted) {
      // Skip bot messages to avoid echo loops
      if (msg.author.bot) continue;

      this.lastMessageId = msg.id;

      const incoming: IncomingMessage = {
        channelId:  this.id,
        senderId:   msg.author.id,
        senderName: msg.author.username,
        text:       msg.content,
        metadata:   { discordChannelId: msg.channel_id, messageId: msg.id },
      };

      await this.handler(incoming).catch(() => { /* non-fatal */ });
    }
  }
}

/** Singleton Discord channel — register with registerChannelPlugin(). */
export const discordChannel = new DiscordChannel();
