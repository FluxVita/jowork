// @jowork/core/channels — notification channel abstraction
// Free: Web (in-app). Premium: additional channels (Telegram, Discord, Slack)

export interface Notification {
  title: string;
  body: string;
  url?: string;
  agentId?: string;
  userId: string;
}

export interface Channel {
  name: string;
  send(notification: Notification): Promise<void>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

const channels = new Map<string, Channel>();

export function registerChannel(channel: Channel): void {
  channels.set(channel.name, channel);
}

export function getChannel(name: string): Channel | undefined {
  return channels.get(name);
}

export async function broadcast(notification: Notification): Promise<void> {
  const promises = Array.from(channels.values()).map(ch =>
    ch.send(notification).catch(() => { /* individual channel failures are non-fatal */ }),
  );
  await Promise.all(promises);
}

// ─── Built-in: in-memory Web channel (SSE-ready) ─────────────────────────────

/** Simple in-memory queue for Web channel (consumed by SSE endpoint). */
const webQueue: Array<{ userId: string; notification: Notification; ts: string }> = [];
const MAX_QUEUE = 100;

export const WebChannel: Channel = {
  name: 'web',
  async send(notification) {
    webQueue.unshift({ userId: notification.userId, notification, ts: new Date().toISOString() });
    if (webQueue.length > MAX_QUEUE) webQueue.length = MAX_QUEUE;
  },
};

export function drainWebQueue(userId: string): Array<{ notification: Notification; ts: string }> {
  const items = webQueue.filter(i => i.userId === userId);
  // Remove from queue after drain
  for (const item of items) {
    const idx = webQueue.indexOf(item);
    if (idx !== -1) webQueue.splice(idx, 1);
  }
  return items.map(({ notification, ts }) => ({ notification, ts }));
}

// Register web channel by default
registerChannel(WebChannel);
