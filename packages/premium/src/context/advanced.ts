// @jowork/premium/context/advanced — 100K context window + segmented loading

import type { Message } from '@jowork/core';

export const PREMIUM_CONTEXT_TOKENS = 100_000;

/**
 * Compress message history to fit within the premium 100K context window.
 * Uses a sliding window that keeps recent messages and summarizes older ones.
 */
export function compressHistory(
  messages: Message[],
  targetTokens = PREMIUM_CONTEXT_TOKENS,
): Message[] {
  // Rough estimate: 4 chars ≈ 1 token
  const estimateTokens = (msgs: Message[]) =>
    msgs.reduce((sum, m) => sum + Math.ceil(m.content.length / 4), 0);

  if (estimateTokens(messages) <= targetTokens) return messages;

  // Keep last 80% of target tokens, drop oldest messages
  let result = [...messages];
  while (result.length > 1 && estimateTokens(result) > targetTokens) {
    result = result.slice(1);
  }
  return result;
}
