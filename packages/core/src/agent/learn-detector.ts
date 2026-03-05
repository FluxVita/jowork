/**
 * agent/learn-detector.ts — Agent 自学习触发检测（§6.3）
 *
 * 轻量级实现：通过模式匹配检测用户消息中的稳定偏好表达，
 * 生成学习建议供用户确认后写入 context_docs。
 */

export interface LearnSuggestion {
  /** 建议标题（简洁描述偏好） */
  title: string;
  /** 建议内容（完整偏好描述） */
  content: string;
}

/** 偏好模式：正则 + 内容提取器 */
const PREFERENCE_PATTERNS: Array<{
  pattern: RegExp;
  extract: (match: RegExpMatchArray, msg: string) => LearnSuggestion | null;
}> = [
  {
    // "记住[我/这个]：..." 显式请求记住
    pattern: /记住[我这个：:]*[：:]\s*(.{5,100})/,
    extract: (m) => ({
      title: '用户偏好',
      content: m[1].trim(),
    }),
  },
  {
    // "我喜欢..." / "我不喜欢..."
    pattern: /我(喜欢|不喜欢|讨厌|偏好|更喜欢)([^，。！？\n]{5,80})/,
    extract: (m) => ({
      title: `${m[1] === '喜欢' || m[1] === '偏好' || m[1] === '更喜欢' ? '偏好' : '不喜欢'}：${m[2].slice(0, 20)}`,
      content: `用户${m[1]}${m[2].trim()}`,
    }),
  },
  {
    // "我习惯..." / "我通常..."
    pattern: /我(习惯|通常|总是|一般会)([^，。！？\n]{5,80})/,
    extract: (m) => ({
      title: `工作习惯：${m[2].slice(0, 20)}`,
      content: `用户${m[1]}${m[2].trim()}`,
    }),
  },
  {
    // "以后[每次/请]..." / "下次..."
    pattern: /(?:以后|下次)(?:每次|请)?\s*([^，。！？\n]{5,80})/,
    extract: (m) => ({
      title: `偏好：${m[1].slice(0, 20)}`,
      content: m[1].trim(),
    }),
  },
];

/**
 * 检测消息中是否包含稳定偏好表达。
 *
 * @param userMessage 用户消息内容
 * @returns 学习建议，或 null（无需记录）
 */
export function detectLearnSuggestion(userMessage: string): LearnSuggestion | null {
  if (!userMessage || userMessage.length < 8) return null;

  for (const { pattern, extract } of PREFERENCE_PATTERNS) {
    const match = userMessage.match(pattern);
    if (match) {
      const suggestion = extract(match, userMessage);
      if (suggestion) return suggestion;
    }
  }

  return null;
}
