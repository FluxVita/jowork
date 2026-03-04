// @jowork/core/channels/webhook — Generic webhook channel plugin (JoworkChannel impl)
//
// Inbound: external systems POST to /api/channels/webhook/receive with
//          Authorization: Bearer <WEBHOOK_SECRET>
//          Body: { text: string; senderId?: string; senderName?: string }
//
// Outbound: if webhookUrl is configured, sends HTTP POST to that URL when
//           the agent calls sendText().
//
// Config (via ChannelConfig or environment):
//   secret      — required bearer token for inbound auth (WEBHOOK_SECRET env)
//   webhookUrl  — optional outbound URL to POST agent replies to

import type {
  JoworkChannel,
  ChannelConfig,
  ChannelTarget,
  IncomingMessage,
  ChannelCapabilities,
  RichCard,
} from './protocol.js';

export interface WebhookIncomingPayload {
  text: string;
  senderId?: string;
  senderName?: string;
}

class WebhookChannel implements JoworkChannel {
  readonly id = 'webhook';
  readonly name = 'Webhook';
  readonly capabilities: ChannelCapabilities = {
    richCards:   true,
    fileUpload:  false,
    reactions:   false,
    threads:     false,
    editMessage: false,
  };

  private secret     = '';
  private webhookUrl = '';
  private handler: ((msg: IncomingMessage) => Promise<void>) | null = null;

  async initialize(config: ChannelConfig): Promise<void> {
    this.secret     = (config['secret'] as string) ?? '';
    this.webhookUrl = (config['webhookUrl'] as string) ?? '';
    if (!this.secret) throw new Error('Webhook channel requires a secret token');
  }

  async shutdown(): Promise<void> {
    this.secret     = '';
    this.webhookUrl = '';
    this.handler    = null;
  }

  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async sendText(target: ChannelTarget, text: string): Promise<void> {
    if (!this.webhookUrl) return; // no outbound URL configured — silently skip
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, text }),
    });
  }

  async sendRichCard(target: ChannelTarget, card: RichCard): Promise<void> {
    if (!this.webhookUrl) return;
    await fetch(this.webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, card }),
    });
  }

  // ── Inbound entry point (called from router) ──────────────────────────────

  /** Validate the bearer token. Returns true if the token matches. */
  validateToken(token: string): boolean {
    return this.secret.length > 0 && token === this.secret;
  }

  /** Process an inbound webhook payload from an external system */
  async handleIncoming(payload: WebhookIncomingPayload): Promise<void> {
    if (!this.handler) return;
    const incoming: IncomingMessage = {
      channelId:  this.id,
      senderId:   payload.senderId  ?? 'external',
      senderName: payload.senderName ?? 'External Webhook',
      text:       payload.text,
    };
    await this.handler(incoming);
  }
}

/** Singleton webhook channel — register with registerChannelPlugin() */
export const webhookChannel = new WebhookChannel();
