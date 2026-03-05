/**
 * Channel 抽象接口 — Agent 的多渠道接入层。
 */

export interface Channel {
  id: string;
  type: 'web' | 'feishu' | 'telegram' | 'cli' | 'discord' | string;
  /** 发送文本回复 */
  sendText(sessionId: string, text: string): Promise<void>;
  /** 发送正在输入状态 */
  sendTyping(sessionId: string): Promise<void>;
  /** 发送错误信息 */
  sendError(sessionId: string, error: string): Promise<void>;
}

/** Channel 上下文信息 */
export interface ChannelContext {
  channel: Channel;
  /** 渠道特有的用户标识（如飞书 open_id） */
  channelUserId: string;
  /** 渠道特有的对话标识（如飞书 chat_id） */
  channelChatId?: string;
}

// ─── JoworkChannel 插件接口（扩展版） ────────────────────────────────────────

export interface Attachment {
  name: string;
  url?: string;
  data?: Buffer;
  mime_type: string;
}

export interface RichCard {
  title?: string;
  body: string;
  /** 卡片颜色标记: 'info' | 'success' | 'warning' | 'error' */
  color?: 'info' | 'success' | 'warning' | 'error';
  actions?: Array<{ label: string; url?: string }>;
}

export interface ChannelTarget {
  /** 渠道内的会话/聊天 ID */
  chat_id: string;
  /** 消息线程 ID（可选） */
  thread_id?: string;
}

/** 从外部渠道进入 Jowork 的消息 */
export interface IncomingMessage {
  channel_id: string;
  sender_id: string;       // 渠道内的用户标识
  sender_name: string;
  text: string;
  attachments?: Attachment[];
  reply_to?: string;       // 线程回复
  metadata?: Record<string, unknown>;
}

/**
 * JoworkChannel 完整插件接口。
 * 比基础 Channel 接口提供更完整的能力声明和消息接收钩子。
 */
export interface JoworkChannel {
  readonly id: string;
  readonly name: string;
  readonly type: string;

  // === 生命周期 ===
  initialize(config: ChannelConfig): Promise<void>;
  shutdown(): Promise<void>;

  // === 接收消息（外部 → Jowork） ===
  onMessage(handler: (msg: IncomingMessage) => Promise<void>): void;

  // === 发送消息（Jowork → 外部） ===
  sendText(target: ChannelTarget, text: string): Promise<void>;
  sendRichCard?(target: ChannelTarget, card: RichCard): Promise<void>;
  sendFile?(target: ChannelTarget, file: Buffer, filename: string): Promise<void>;

  // === 能力声明 ===
  capabilities: {
    richCards: boolean;
    fileUpload: boolean;
    reactions: boolean;
    threads: boolean;
    editMessage: boolean;
  };
}

export interface ChannelConfig {
  /** Bot token 或 App secret */
  token?: string;
  /** Webhook 密钥（用于验证请求） */
  webhook_secret?: string;
  /** 轮询间隔（毫秒），仅 polling 模式使用 */
  poll_interval_ms?: number;
  [key: string]: unknown;
}

/**
 * 将 JoworkChannel 适配为基础 Channel 接口。
 * 允许 JoworkChannel 注册到现有 channelRegistry。
 */
export function adaptJoworkChannel(jc: JoworkChannel, onMsg: (msg: IncomingMessage) => Promise<void>): Channel {
  jc.onMessage(onMsg);
  return {
    id: jc.id,
    type: jc.type,
    async sendText(_sessionId: string, text: string) {
      // JoworkChannel 不依赖 sessionId 路由；调用方需在 onMsg 中记录 chat_id 映射
      void text;
    },
    async sendTyping(_sessionId: string) { /* best-effort */ },
    async sendError(_sessionId: string, error: string) {
      void error;
    },
  };
}
