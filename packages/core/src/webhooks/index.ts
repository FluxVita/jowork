// @jowork/core/webhooks — Outbound webhook event system
//
// Allows registering webhook URLs that receive POST notifications
// when events occur in Jowork (message sent, connector synced, etc.)
// Uses fire-and-forget with retry for delivery.

import { randomUUID } from 'node:crypto';
import { createHmac } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { logger } from '../utils/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export type WebhookEventType =
  | 'message.created'
  | 'session.created'
  | 'session.deleted'
  | 'connector.synced'
  | 'memory.created'
  | 'agent.updated';

export interface WebhookSubscription {
  id: string;
  url: string;
  secret: string;
  events: WebhookEventType[];
  ownerId: string;
  isActive: boolean;
  createdAt: string;
}

export interface CreateWebhookInput {
  url: string;
  events: WebhookEventType[];
  ownerId: string;
}

export interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  timestamp: string;
  data: Record<string, unknown>;
}

interface DbRow {
  id: string;
  url: string;
  secret: string;
  events: string; // JSON array
  owner_id: string;
  is_active: number;
  created_at: string;
}

function rowToSubscription(row: DbRow): WebhookSubscription {
  return {
    id: row.id,
    url: row.url,
    secret: row.secret,
    events: JSON.parse(row.events) as WebhookEventType[],
    ownerId: row.owner_id,
    isActive: row.is_active === 1,
    createdAt: row.created_at,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function createWebhook(input: CreateWebhookInput): WebhookSubscription {
  const db = getDb();
  const id = randomUUID();
  const secret = randomUUID().replace(/-/g, '');
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO webhook_subscriptions (id, url, secret, events, owner_id, is_active, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(id, input.url, secret, JSON.stringify(input.events), input.ownerId, now);

  return { id, url: input.url, secret, events: input.events, ownerId: input.ownerId, isActive: true, createdAt: now };
}

export function listWebhooks(ownerId: string): WebhookSubscription[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM webhook_subscriptions WHERE owner_id = ? ORDER BY created_at DESC`).all(ownerId) as DbRow[];
  return rows.map(rowToSubscription);
}

export function getWebhook(id: string): WebhookSubscription | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM webhook_subscriptions WHERE id = ?`).get(id) as DbRow | undefined;
  return row ? rowToSubscription(row) : undefined;
}

export function toggleWebhook(id: string, ownerId: string, active: boolean): boolean {
  const db = getDb();
  const result = db.prepare(`UPDATE webhook_subscriptions SET is_active = ? WHERE id = ? AND owner_id = ?`).run(active ? 1 : 0, id, ownerId);
  return result.changes > 0;
}

export function deleteWebhook(id: string, ownerId: string): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM webhook_subscriptions WHERE id = ? AND owner_id = ?`).run(id, ownerId);
  return result.changes > 0;
}

// ─── Event Dispatch ──────────────────────────────────────────────────────────

function signPayload(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

/** Fire-and-forget: dispatch event to all matching subscriptions. */
export function emitWebhookEvent(type: WebhookEventType, data: Record<string, unknown>): void {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM webhook_subscriptions WHERE is_active = 1`).all() as DbRow[];

  const event: WebhookEvent = {
    id: randomUUID(),
    type,
    timestamp: new Date().toISOString(),
    data,
  };

  for (const row of rows) {
    const events = JSON.parse(row.events) as string[];
    if (!events.includes(type) && !events.includes('*')) continue;

    const payload = JSON.stringify(event);
    const signature = signPayload(payload, row.secret);

    // Fire and forget — do not block caller
    fetch(row.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Jowork-Signature': `sha256=${signature}`,
        'X-Jowork-Event': type,
      },
      body: payload,
      signal: AbortSignal.timeout(10000),
    }).catch(err => {
      logger.warn('Webhook delivery failed', { webhookId: row.id, url: row.url, error: String(err) });
    });
  }
}
