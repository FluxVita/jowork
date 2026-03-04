// @jowork/core/channels/protocol — JoworkChannel plugin interface (§10.2)

export interface ChannelConfig {
  [key: string]: unknown;
}

export interface ChannelTarget {
  /** Channel-specific identifier: chat_id, user_id, room_id, etc. */
  id: string;
  type: 'user' | 'group' | 'channel';
}

export interface IncomingMessage {
  /** Which channel this came from */
  channelId: string;
  /** Channel-scoped sender identifier */
  senderId: string;
  senderName: string;
  text: string;
  attachments?: Attachment[];
  /** For threaded replies */
  replyTo?: string;
  metadata?: Record<string, unknown>;
}

export interface Attachment {
  type: 'image' | 'file' | 'audio' | 'video';
  url?: string;
  data?: Buffer;
  filename?: string;
  mimeType?: string;
}

export interface RichCard {
  title?: string;
  body: string;
  fields?: Array<{ label: string; value: string; inline?: boolean }>;
  footer?: string;
  color?: string;
}

export interface ChannelCapabilities {
  richCards: boolean;
  fileUpload: boolean;
  reactions: boolean;
  threads: boolean;
  editMessage: boolean;
}

// ─── JoworkChannel interface ──────────────────────────────────────────────────

export interface JoworkChannel {
  readonly id: string;
  readonly name: string;
  readonly capabilities: ChannelCapabilities;

  // Lifecycle
  initialize(config: ChannelConfig): Promise<void>;
  shutdown(): Promise<void>;

  // Receive (from external channel → Jowork agent)
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;

  // Send (from Jowork agent → external channel)
  sendText(target: ChannelTarget, text: string): Promise<void>;
  sendRichCard?(target: ChannelTarget, card: RichCard): Promise<void>;
  sendFile?(target: ChannelTarget, data: Buffer, filename: string): Promise<void>;
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const channelPluginRegistry = new Map<string, JoworkChannel>();
const channelInitializedSet = new Set<string>();

export function registerChannelPlugin(channel: JoworkChannel): void {
  channelPluginRegistry.set(channel.id, channel);
}

export function getChannelPlugin(id: string): JoworkChannel | undefined {
  return channelPluginRegistry.get(id);
}

export function listChannelPlugins(): Array<{ id: string; name: string; capabilities: ChannelCapabilities; initialized: boolean }> {
  return Array.from(channelPluginRegistry.values()).map(c => ({
    id:           c.id,
    name:         c.name,
    capabilities: c.capabilities,
    initialized:  channelInitializedSet.has(c.id),
  }));
}

export function markChannelInitialized(id: string): void {
  channelInitializedSet.add(id);
}

export function markChannelShutdown(id: string): void {
  channelInitializedSet.delete(id);
}

export function isChannelInitialized(id: string): boolean {
  return channelInitializedSet.has(id);
}
