/**
 * Channel 注册中心 — 管理所有可用渠道。
 */

import { webChannel } from './web.js';
import { FeishuChannel } from './feishu.js';
import type { Channel } from './types.js';

export { webChannel } from './web.js';
export { FeishuChannel } from './feishu.js';
export type { Channel } from './types.js';

const channels = new Map<string, Channel>();

/** 初始化默认渠道 */
export function initChannels(): void {
  registerChannel(webChannel);
}

export function registerChannel(channel: Channel): void {
  channels.set(channel.id, channel);
}

export function getChannel(id: string): Channel | undefined {
  return channels.get(id);
}

export function getAllChannels(): Channel[] {
  return Array.from(channels.values());
}

/** 创建飞书渠道实例（每个 chat_id 一个） */
export function createFeishuChannel(chatId: string): FeishuChannel {
  const id = `feishu_${chatId}`;
  let channel = channels.get(id) as FeishuChannel | undefined;
  if (!channel) {
    channel = new FeishuChannel(chatId);
    channel.id = id;
    channels.set(id, channel);
  }
  return channel;
}
