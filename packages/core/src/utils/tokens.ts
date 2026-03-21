/**
 * Estimate token count for a text string.
 * Rough heuristic: ~4 chars per token (English), ~2 chars per token (CJK).
 * Used across desktop and cloud for token budgeting.
 */
export function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 2 + otherChars / 4);
}
