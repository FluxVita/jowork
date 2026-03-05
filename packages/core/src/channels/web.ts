/**
 * Web Channel — 封装现有 SSE 逻辑，保持向后兼容。
 *
 * Web Channel 不直接发送消息，而是通过 AgentEvent yield 机制
 * 由 SSE 路由写入 HTTP 响应。这里作为 Channel 接口的 no-op 实现，
 * 使 Agent Controller 统一使用 Channel 抽象。
 */

import type { Channel } from './types.js';

export class WebChannel implements Channel {
  id = 'web';
  type = 'web' as const;

  /** Web 通道的文本发送由 SSE yield 机制处理，此处为 no-op */
  async sendText(_sessionId: string, _text: string): Promise<void> {
    // SSE 路由直接 yield event，不需要 Channel 发送
  }

  async sendTyping(_sessionId: string): Promise<void> {
    // SSE thinking event 已由 yield 处理
  }

  async sendError(_sessionId: string, _error: string): Promise<void> {
    // SSE error event 已由 yield 处理
  }
}

/** 单例 */
export const webChannel = new WebChannel();
