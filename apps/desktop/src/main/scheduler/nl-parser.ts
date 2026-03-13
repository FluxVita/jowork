/**
 * Natural language → cron expression parser.
 * Supports common Chinese and English scheduling phrases.
 */

interface NLRule {
  pattern: RegExp;
  toCron: (match: RegExpMatchArray) => string;
}

const NL_RULES: NLRule[] = [
  // "every N minutes" / "每 N 分钟"
  { pattern: /^(?:every\s+)?(\d+)\s*(?:min(?:utes?)?|分钟?)$/i, toCron: (m) => `*/${m[1]} * * * *` },
  // "every N hours" / "每 N 小时"
  { pattern: /^(?:every\s+)?(\d+)\s*(?:hours?|小时)$/i, toCron: (m) => `0 */${m[1]} * * *` },
  // "every hour" / "每小时"
  { pattern: /^every\s+hour$|^每小时$/i, toCron: () => '0 * * * *' },
  // "every day at HH:MM" / "每天 HH:MM" / "每天 H 点"
  { pattern: /^(?:every\s+day\s+(?:at\s+)?|每天\s*)(\d{1,2}):(\d{2})$/i, toCron: (m) => `${m[2]} ${m[1]} * * *` },
  { pattern: /^(?:every\s+day\s+(?:at\s+)?|每天\s*)(\d{1,2})\s*(?:点|am|pm)?$/i, toCron: (m) => `0 ${m[1]} * * *` },
  // "每天早上 H 点" / "every morning at H"
  { pattern: /^(?:每天)?早上?\s*(\d{1,2})\s*(?:点|am)?$/i, toCron: (m) => `0 ${m[1]} * * *` },
  { pattern: /^every\s+morning\s+(?:at\s+)?(\d{1,2})$/i, toCron: (m) => `0 ${m[1]} * * *` },
  // "每天下午/晚上 H 点"
  { pattern: /^(?:每天)?(?:下午|晚上)\s*(\d{1,2})\s*点?$/i, toCron: (m) => {
    const h = parseInt(m[1], 10);
    return `0 ${h < 12 ? h + 12 : h} * * *`;
  }},
  // "weekdays at H" / "工作日 H 点"
  { pattern: /^(?:weekdays?\s+(?:at\s+)?|工作日\s*)(\d{1,2})\s*(?:点|am|pm)?$/i, toCron: (m) => `0 ${m[1]} * * 1-5` },
  // "every monday at H" / "每周一 H 点"
  { pattern: /^(?:every\s+)?(?:monday|周一|星期一)\s*(?:at\s+)?(\d{1,2})\s*(?:点|am)?$/i, toCron: (m) => `0 ${m[1]} * * 1` },
  { pattern: /^(?:every\s+)?(?:tuesday|周二|星期二)\s*(?:at\s+)?(\d{1,2})\s*(?:点|am)?$/i, toCron: (m) => `0 ${m[1]} * * 2` },
  { pattern: /^(?:every\s+)?(?:wednesday|周三|星期三)\s*(?:at\s+)?(\d{1,2})\s*(?:点|am)?$/i, toCron: (m) => `0 ${m[1]} * * 3` },
  { pattern: /^(?:every\s+)?(?:thursday|周四|星期四)\s*(?:at\s+)?(\d{1,2})\s*(?:点|am)?$/i, toCron: (m) => `0 ${m[1]} * * 4` },
  { pattern: /^(?:every\s+)?(?:friday|周五|星期五)\s*(?:at\s+)?(\d{1,2})\s*(?:点|am)?$/i, toCron: (m) => `0 ${m[1]} * * 5` },
  // "twice daily" / "每天两次"
  { pattern: /^twice\s+daily$|^每天两次$/i, toCron: () => '0 9,18 * * *' },
  // "every N days" / "每 N 天"
  { pattern: /^(?:every\s+)?(\d+)\s*(?:days?|天)$/i, toCron: (m) => `0 0 */${m[1]} * *` },
];

/**
 * Parse a natural language scheduling phrase into a cron expression.
 * Returns null if no match.
 */
export function parseNaturalLanguageCron(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  for (const rule of NL_RULES) {
    const match = trimmed.match(rule.pattern);
    if (match) {
      return rule.toCron(match);
    }
  }

  return null;
}
