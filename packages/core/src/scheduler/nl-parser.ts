/**
 * 自然语言 Cron 解析器
 * 将中文/英文自然语言时间描述转换为 Cron 表达式 + 动作配置
 * 纯规则引擎，不依赖外部模型
 */

import { createLogger } from '../utils/logger.js';

const log = createLogger('nl-cron-parser');

export interface NLParseResult {
  cron_expr: string;
  name: string;
  action_type: 'message' | 'report' | 'sync' | 'custom';
  action_config: {
    template?: string;
    target_channel?: string;
    target_user_id?: string;
    connector_id?: string;
    query?: string;
  };
  confidence: number; // 0-1
  human_readable: string; // 解析结果的人类可读描述
}

// ─── 时间模式 ───

interface TimePattern {
  pattern: RegExp;
  extract: (match: RegExpMatchArray) => { hour?: number; minute?: number; cron_time?: string };
}

const TIME_PATTERNS: TimePattern[] = [
  // 带 AM/PM 前缀的中文 — 必须在裸数字之前匹配
  { pattern: /下午(\d{1,2})点(\d{1,2})分/, extract: (m) => ({ hour: parseInt(m[1]) + (parseInt(m[1]) < 12 ? 12 : 0), minute: parseInt(m[2]) }) },
  { pattern: /下午(\d{1,2})点半/, extract: (m) => ({ hour: parseInt(m[1]) + (parseInt(m[1]) < 12 ? 12 : 0), minute: 30 }) },
  { pattern: /下午(\d{1,2})点/, extract: (m) => ({ hour: parseInt(m[1]) + (parseInt(m[1]) < 12 ? 12 : 0), minute: 0 }) },
  { pattern: /上午(\d{1,2})点(\d{1,2})分/, extract: (m) => ({ hour: parseInt(m[1]), minute: parseInt(m[2]) }) },
  { pattern: /上午(\d{1,2})点/, extract: (m) => ({ hour: parseInt(m[1]), minute: 0 }) },
  { pattern: /晚上?(\d{1,2})点(\d{1,2})分/, extract: (m) => ({ hour: parseInt(m[1]) + (parseInt(m[1]) < 12 ? 12 : 0), minute: parseInt(m[2]) }) },
  { pattern: /晚上?(\d{1,2})点/, extract: (m) => ({ hour: parseInt(m[1]) + (parseInt(m[1]) < 12 ? 12 : 0), minute: 0 }) },
  { pattern: /早上?(\d{1,2})点(\d{1,2})分/, extract: (m) => ({ hour: parseInt(m[1]), minute: parseInt(m[2]) }) },
  { pattern: /早上?(\d{1,2})点/, extract: (m) => ({ hour: parseInt(m[1]), minute: 0 }) },
  // "at 10am" / "at 3pm" / "at 10:30am"
  { pattern: /at\s+(\d{1,2}):?(\d{2})?\s*pm/i, extract: (m) => ({ hour: parseInt(m[1]) + (parseInt(m[1]) < 12 ? 12 : 0), minute: parseInt(m[2] || '0') }) },
  { pattern: /at\s+(\d{1,2}):?(\d{2})?\s*am/i, extract: (m) => ({ hour: parseInt(m[1]), minute: parseInt(m[2] || '0') }) },
  // 裸数字时间
  { pattern: /(\d{1,2})[:.：](\d{2})/, extract: (m) => ({ hour: parseInt(m[1]), minute: parseInt(m[2]) }) },
  { pattern: /(\d{1,2})点(\d{1,2})分/, extract: (m) => ({ hour: parseInt(m[1]), minute: parseInt(m[2]) }) },
  { pattern: /(\d{1,2})点半/, extract: (m) => ({ hour: parseInt(m[1]), minute: 30 }) },
  { pattern: /(\d{1,2})点整?/, extract: (m) => ({ hour: parseInt(m[1]), minute: 0 }) },
  { pattern: /at\s+(\d{1,2}):(\d{2})/i, extract: (m) => ({ hour: parseInt(m[1]), minute: parseInt(m[2]) }) },
];

// ─── 频率模式 ───

interface TimeArg { hour: number; minute: number }

interface FreqPattern {
  pattern: RegExp;
  cron: (time: TimeArg, match: RegExpMatchArray) => string;
  readable: string | ((match: RegExpMatchArray) => string);
}

const FREQ_PATTERNS: FreqPattern[] = [
  // 每天
  { pattern: /每天|每日|daily|every\s*day/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * *`, readable: '每天' },
  // 每周一到五 / 工作日
  { pattern: /工作日|周一到周五|weekday|mon.*fri/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 1-5`, readable: '工作日' },
  // 每周末
  { pattern: /周末|weekend/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 0,6`, readable: '周末' },
  // 具体星期
  { pattern: /(?:每)?周一|monday/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 1`, readable: '每周一' },
  { pattern: /(?:每)?周二|tuesday/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 2`, readable: '每周二' },
  { pattern: /(?:每)?周三|wednesday/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 3`, readable: '每周三' },
  { pattern: /(?:每)?周四|thursday/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 4`, readable: '每周四' },
  { pattern: /(?:每)?周五|friday/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 5`, readable: '每周五' },
  { pattern: /(?:每)?周六|saturday/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 6`, readable: '每周六' },
  { pattern: /(?:每)?周日|(?:每)?周天|sunday/i, cron: (t: TimeArg) => `${t.minute} ${t.hour} * * 0`, readable: '每周日' },
  // 每月几号
  { pattern: /每月(\d{1,2})[号日]/, cron: (t: TimeArg, m: RegExpMatchArray) => `${t.minute} ${t.hour} ${parseInt(m[1])} * *`, readable: (m: RegExpMatchArray) => `每月${m[1]}号` },
  // 每 N 小时
  { pattern: /每(\d+)小时|every\s*(\d+)\s*hour/i, cron: (_t: TimeArg, m: RegExpMatchArray) => `0 */${parseInt(m[1] || m[2])} * * *`, readable: (m: RegExpMatchArray) => `每${m[1] || m[2]}小时` },
  // 每 N 分钟
  { pattern: /每(\d+)分钟|every\s*(\d+)\s*min/i, cron: (_t: TimeArg, m: RegExpMatchArray) => `*/${parseInt(m[1] || m[2])} * * * *`, readable: (m: RegExpMatchArray) => `每${m[1] || m[2]}分钟` },
];

// ─── 动作类型检测 ───

interface ActionKeyword {
  pattern: RegExp;
  action_type: 'message' | 'report' | 'sync';
}

const ACTION_KEYWORDS: ActionKeyword[] = [
  { pattern: /推送|发送|通知|提醒|send|notify|push|remind/i, action_type: 'message' },
  { pattern: /报告|汇总|总结|统计|report|summary|stats/i, action_type: 'report' },
  { pattern: /同步|拉取|刷新|更新|sync|pull|refresh|update/i, action_type: 'sync' },
];

// ─── 目标渠道检测 ───

function detectChannel(input: string): string | undefined {
  if (/产品群|产品组/.test(input)) return 'feishu_group:product';
  if (/技术群|开发群|研发群/.test(input)) return 'feishu_group:dev';
  if (/设计群/.test(input)) return 'feishu_group:design';
  if (/运营群|增长群/.test(input)) return 'feishu_group:ops';
  if (/全体群|公司群|全员群/.test(input)) return 'feishu_group:all';
  if (/telegram/i.test(input)) return 'telegram';
  if (/看板|网页|dashboard|web/i.test(input)) return 'web';
  if (/私聊|给我|send me/i.test(input)) return 'private';
  return undefined;
}

// ─── 内容模板提取 ───

function extractTemplate(input: string): string | undefined {
  // "推送用户反馈摘要" → "用户反馈摘要"
  // "总结昨天的数据" → "昨天的数据"
  const templatePatterns = [
    /(?:推送|发送|通知|汇总|总结|统计)(?:一下)?(.+?)(?:到|给|在|$)/,
    /(?:send|push|notify|summarize)\s+(.+?)(?:\s+to|\s+in|$)/i,
  ];

  for (const pat of templatePatterns) {
    const match = input.match(pat);
    if (match?.[1]?.trim()) return match[1].trim();
  }

  return undefined;
}

// ─── 数据源检测 ───

function detectConnector(input: string): string | undefined {
  if (/反馈|投诉|邮件|email|feedback|complaint/i.test(input)) return 'email';
  if (/飞书|lark|feishu|文档|wiki/i.test(input)) return 'feishu_v1';
  if (/gitlab|代码|mr|merge|pipeline/i.test(input)) return 'gitlab_v1';
  if (/linear|issue|任务|bug/i.test(input)) return 'linear_v1';
  if (/posthog|数据|指标|留存|活跃|analytics/i.test(input)) return 'posthog_v1';
  if (/figma|设计|design/i.test(input)) return 'figma_v1';
  return undefined;
}

// ─── 主解析函数 ───

export function parseNaturalLanguageCron(input: string): NLParseResult | null {
  const text = input.trim();
  if (!text) return null;

  log.debug(`Parsing NL cron: "${text}"`);

  // 1. 提取时间
  let hour = 9, minute = 0; // 默认早上 9 点
  let timeFound = false;
  for (const tp of TIME_PATTERNS) {
    const match = text.match(tp.pattern);
    if (match) {
      const result = tp.extract(match);
      if (result.hour !== undefined) hour = result.hour;
      if (result.minute !== undefined) minute = result.minute;
      timeFound = true;
      break;
    }
  }

  // 2. 提取频率
  let cronExpr = '';
  let freqReadable = '每天';
  let freqFound = false;

  for (const fp of FREQ_PATTERNS) {
    const match = text.match(fp.pattern);
    if (match) {
      cronExpr = fp.cron({ hour, minute }, match);
      freqReadable = typeof fp.readable === 'function' ? fp.readable(match) : fp.readable;
      freqFound = true;
      break;
    }
  }

  // 如果没匹配到频率但有时间，默认每天
  if (!freqFound && timeFound) {
    cronExpr = `${minute} ${hour} * * *`;
    freqReadable = '每天';
  }

  // 都没匹配到，解析失败
  if (!cronExpr) {
    log.warn(`Failed to parse NL cron: "${text}"`);
    return null;
  }

  // 3. 检测动作类型
  let actionType: 'message' | 'report' | 'sync' | 'custom' = 'message';
  for (const ak of ACTION_KEYWORDS) {
    if (ak.pattern.test(text)) {
      actionType = ak.action_type;
      break;
    }
  }

  // 4. 检测目标渠道
  const targetChannel = detectChannel(text);

  // 5. 提取模板/查询
  const template = extractTemplate(text);
  const connectorId = detectConnector(text);

  // 6. 生成任务名称
  const name = template
    ? `${freqReadable} ${template}`
    : `${freqReadable} ${actionType === 'report' ? '报告' : actionType === 'sync' ? '同步' : '推送'}`;

  // 7. 计算信心度
  let confidence = 0.5;
  if (timeFound) confidence += 0.2;
  if (freqFound) confidence += 0.2;
  if (template || connectorId) confidence += 0.1;

  const humanReadable = `${freqReadable} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 执行${actionType === 'report' ? '报告' : actionType === 'sync' ? '同步' : '推送'}${template ? `「${template}」` : ''}${targetChannel ? ` → ${targetChannel}` : ''}`;

  const result: NLParseResult = {
    cron_expr: cronExpr,
    name,
    action_type: actionType,
    action_config: {
      ...(template ? { template } : {}),
      ...(targetChannel ? { target_channel: targetChannel } : {}),
      ...(connectorId ? { connector_id: connectorId } : {}),
    },
    confidence,
    human_readable: humanReadable,
  };

  log.info(`NL Cron parsed: "${text}" → ${cronExpr} (${confidence})`);
  return result;
}

/** 将 Cron 表达式转为人类可读描述 */
export function cronToHuman(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;

  const [min, hour, dom, _month, dow] = parts;

  let timePart = '';
  if (min !== '*' && hour !== '*') {
    timePart = `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  } else if (min.startsWith('*/')) {
    return `每 ${min.slice(2)} 分钟`;
  } else if (hour.startsWith('*/')) {
    return `每 ${hour.slice(2)} 小时`;
  }

  let freqPart = '';
  if (dom !== '*' && dow === '*') {
    freqPart = `每月 ${dom} 号`;
  } else if (dow === '1-5') {
    freqPart = '工作日';
  } else if (dow === '0,6') {
    freqPart = '周末';
  } else if (dow !== '*') {
    const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    const days = dow.split(',').map(d => dayNames[parseInt(d)] ?? d).join('、');
    freqPart = `每${days}`;
  } else {
    freqPart = '每天';
  }

  return `${freqPart} ${timePart}`.trim();
}
