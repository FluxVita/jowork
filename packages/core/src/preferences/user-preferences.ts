/**
 * preferences/user-preferences.ts
 * 用户偏好系统 — 支持部分更新
 */
import { getDb } from '../datamap/db.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('preferences');

export interface UserPreferences {
  language?: string;                                         // 默认 zh-CN
  response_style?: 'concise' | 'balanced' | 'detailed';     // 默认 balanced
  timezone?: string;                                         // 默认 Asia/Shanghai
  default_channel?: 'feishu' | 'web';
  custom?: Record<string, unknown>;
}

const DEFAULTS: Required<Omit<UserPreferences, 'custom'>> & { custom: Record<string, unknown> } = {
  language: 'zh-CN',
  response_style: 'balanced',
  timezone: 'Asia/Shanghai',
  default_channel: 'web',
  custom: {},
};

interface PrefRow {
  user_id: string;
  prefs_json: string;
  updated_at: string;
}

/** 获取用户偏好（若不存在返回默认值） */
export function getUserPreferences(user_id: string): UserPreferences & typeof DEFAULTS {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`).get(user_id) as PrefRow | undefined;
  if (!row) return { ...DEFAULTS };

  let stored: UserPreferences = {};
  try {
    stored = JSON.parse(row.prefs_json);
  } catch { /* ignore */ }

  return { ...DEFAULTS, ...stored };
}

/** 部分更新用户偏好 */
export function updateUserPreferences(user_id: string, patch: UserPreferences): UserPreferences {
  const db = getDb();
  const current = getUserPreferences(user_id);
  const merged: UserPreferences = {
    ...current,
    ...patch,
    custom: patch.custom !== undefined
      ? { ...(current.custom ?? {}), ...patch.custom }
      : current.custom,
  };

  db.prepare(`
    INSERT INTO user_preferences (user_id, prefs_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT (user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at
  `).run(user_id, JSON.stringify(merged));

  log.info('Preferences updated', { user_id });
  return merged;
}

/** 重置偏好到默认值 */
export function resetUserPreferences(user_id: string): UserPreferences {
  const db = getDb();
  db.prepare(`DELETE FROM user_preferences WHERE user_id = ?`).run(user_id);
  return { ...DEFAULTS };
}

/** 格式化为 Agent 系统提示注入片段 */
export function formatPrefsForPrompt(prefs: UserPreferences): string {
  const parts: string[] = [];
  if (prefs.language) parts.push(`语言=${prefs.language}`);
  if (prefs.response_style) {
    const styleMap = { concise: '简洁', balanced: '均衡', detailed: '详细' };
    parts.push(`回复风格=${styleMap[prefs.response_style] ?? prefs.response_style}`);
  }
  if (prefs.timezone) parts.push(`时区=${prefs.timezone}`);
  return parts.length > 0 ? `用户偏好：${parts.join('，')}` : '';
}
