import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';
import type { DataSource } from '../types.js';

const log = createLogger('quota');

// 飞书月配额
const FEISHU_MONTHLY_LIMIT = 50_000;
const ALERT_THRESHOLDS = [
  { ratio: 0.70, level: 'warning' as const },
  { ratio: 0.85, level: 'degraded' as const },
  { ratio: 0.95, level: 'critical' as const },
];

/** 记录一次 API 调用 */
export function trackApiCall(source: DataSource, category: string, count = 1) {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(`
    INSERT INTO quota_usage (source, category, count, date) VALUES (?, ?, ?, ?)
  `).run(source, category, count, today);
}

/** 获取飞书当月已使用量 */
export function getFeishuMonthlyUsage(): {
  used: number;
  limit: number;
  ratio: number;
  alert_level: 'ok' | 'warning' | 'degraded' | 'critical' | 'exhausted';
} {
  const db = getDb();
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  const row = db.prepare(`
    SELECT COALESCE(SUM(count), 0) as total FROM quota_usage
    WHERE source = 'feishu' AND date >= ?
  `).get(monthStart) as { total: number };

  const used = row.total;
  const ratio = used / FEISHU_MONTHLY_LIMIT;

  let alert_level: 'ok' | 'warning' | 'degraded' | 'critical' | 'exhausted' = 'ok';
  if (ratio >= 1.0) alert_level = 'exhausted';
  else {
    for (const t of ALERT_THRESHOLDS) {
      if (ratio >= t.ratio) alert_level = t.level;
    }
  }

  if (alert_level !== 'ok') {
    log.warn(`Feishu quota ${alert_level}`, { used, limit: FEISHU_MONTHLY_LIMIT, ratio: Math.round(ratio * 100) + '%' });
  }

  return { used, limit: FEISHU_MONTHLY_LIMIT, ratio, alert_level };
}

/** 获取配额看板数据 */
export function getQuotaDashboard() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const todayBySource = db.prepare(`
    SELECT source, SUM(count) as total FROM quota_usage
    WHERE date = ? GROUP BY source
  `).all(today) as { source: string; total: number }[];

  const feishu = getFeishuMonthlyUsage();

  return { today: todayBySource, feishu_monthly: feishu };
}

/** 检查是否允许调用（配额保护） */
export function canCallFeishu(category: string): boolean {
  const { alert_level } = getFeishuMonthlyUsage();

  if (alert_level === 'exhausted') return false;

  // critical 模式下只允许 P0 操作
  if (alert_level === 'critical') {
    const p0Categories = ['bot_reply', 'urgent_doc_fetch'];
    return p0Categories.includes(category);
  }

  // degraded 模式下关闭轮询类操作
  if (alert_level === 'degraded') {
    const pollingCategories = ['message_poll', 'doc_discovery', 'calendar_sync'];
    return !pollingCategories.includes(category);
  }

  return true;
}
