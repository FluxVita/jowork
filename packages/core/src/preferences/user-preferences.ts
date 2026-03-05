/**
 * preferences/user-preferences.ts
 * 用户偏好系统 — 支持部分更新
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('preferences');

// 内部存储键（不在公开接口中暴露）
const ENC_API_KEY_FIELD = '_enc_api_key';

// 加密密钥（取 jwt_secret 的前 32 字节）
function getEncKey(): Buffer {
  return Buffer.from(config.jwt_secret.padEnd(32, '0').slice(0, 32), 'utf-8');
}

function encryptApiKey(raw: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-gcm', getEncKey(), iv);
  const encrypted = Buffer.concat([cipher.update(raw, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decryptApiKey(encoded: string): string {
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const decipher = createDecipheriv('aes-256-gcm', getEncKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

export interface UserPreferences {
  language?: string;                                         // 默认 zh-CN
  response_style?: 'concise' | 'balanced' | 'detailed';     // 默认 balanced
  timezone?: string;                                         // 默认 Asia/Shanghai
  default_channel?: 'feishu' | 'web';
  use_case?: 'personal' | 'team';                           // Onboarding 选择
  api_mode?: 'own_key' | 'subscription';                    // AI 模型访问方式
  deploy_mode?: 'desktop' | 'server';                       // 部署模式
  custom?: Record<string, unknown>;
}

const DEFAULTS: Required<Omit<UserPreferences, 'custom' | 'use_case' | 'api_mode' | 'deploy_mode'>> & { custom: Record<string, unknown> } = {
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

/** 获取用户偏好（若不存在返回默认值，过滤内部字段） */
export function getUserPreferences(user_id: string): UserPreferences & typeof DEFAULTS {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM user_preferences WHERE user_id = ?`).get(user_id) as PrefRow | undefined;
  if (!row) return { ...DEFAULTS };

  let stored: UserPreferences = {};
  try {
    const raw = JSON.parse(row.prefs_json) as Record<string, unknown>;
    // 过滤内部字段，不暴露给外部
    const { [ENC_API_KEY_FIELD]: _, ...rest } = raw;
    stored = rest as UserPreferences;
  } catch { /* ignore */ }

  return { ...DEFAULTS, ...stored };
}

/** 存储加密的 API Key */
export function storeApiKey(user_id: string, rawKey: string): void {
  const db = getDb();
  const row = db.prepare(`SELECT prefs_json FROM user_preferences WHERE user_id = ?`).get(user_id) as PrefRow | undefined;
  let prefs: Record<string, unknown> = {};
  if (row) {
    try { prefs = JSON.parse(row.prefs_json); } catch {}
  }
  prefs[ENC_API_KEY_FIELD] = encryptApiKey(rawKey);
  db.prepare(`
    INSERT INTO user_preferences (user_id, prefs_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT (user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at
  `).run(user_id, JSON.stringify(prefs));
  log.info('API key stored (encrypted)', { user_id });
}

/** 检查用户是否已设置 API Key */
export function hasApiKey(user_id: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT prefs_json FROM user_preferences WHERE user_id = ?`).get(user_id) as PrefRow | undefined;
  if (!row) return false;
  try {
    const prefs = JSON.parse(row.prefs_json) as Record<string, unknown>;
    return !!prefs[ENC_API_KEY_FIELD];
  } catch { return false; }
}

/** 获取脱敏的 API Key（前4位 + ... + 后4位） */
export function getApiKeyMasked(user_id: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT prefs_json FROM user_preferences WHERE user_id = ?`).get(user_id) as PrefRow | undefined;
  if (!row) return null;
  try {
    const prefs = JSON.parse(row.prefs_json) as Record<string, unknown>;
    const enc = prefs[ENC_API_KEY_FIELD];
    if (!enc) return null;
    const raw = decryptApiKey(enc as string);
    if (raw.length <= 8) return '****';
    return raw.slice(0, 4) + '...' + raw.slice(-4);
  } catch { return null; }
}

/** 获取原始 API Key（供模型路由使用）*/
export function getApiKeyRaw(user_id: string): string | null {
  const db = getDb();
  const row = db.prepare(`SELECT prefs_json FROM user_preferences WHERE user_id = ?`).get(user_id) as PrefRow | undefined;
  if (!row) return null;
  try {
    const prefs = JSON.parse(row.prefs_json) as Record<string, unknown>;
    const enc = prefs[ENC_API_KEY_FIELD];
    if (!enc) return null;
    return decryptApiKey(enc as string);
  } catch { return null; }
}

/** 部分更新用户偏好（保留内部加密字段） */
export function updateUserPreferences(user_id: string, patch: UserPreferences): UserPreferences {
  const db = getDb();
  const row = db.prepare(`SELECT prefs_json FROM user_preferences WHERE user_id = ?`).get(user_id) as PrefRow | undefined;

  // 读取原始 JSON（含内部字段）
  let rawStored: Record<string, unknown> = {};
  if (row) {
    try { rawStored = JSON.parse(row.prefs_json); } catch {}
  }

  // 提取内部字段（保留）
  const { [ENC_API_KEY_FIELD]: encApiKey, ...publicStored } = rawStored;

  // 合并公开偏好
  const current = { ...DEFAULTS, ...publicStored } as UserPreferences;
  const mergedPublic: UserPreferences = {
    ...current,
    ...patch,
    custom: patch.custom !== undefined
      ? { ...(current.custom ?? {}), ...patch.custom }
      : current.custom,
  };

  // 写回时保留内部字段
  const toStore: Record<string, unknown> = { ...mergedPublic };
  if (encApiKey !== undefined) toStore[ENC_API_KEY_FIELD] = encApiKey;

  db.prepare(`
    INSERT INTO user_preferences (user_id, prefs_json, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT (user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at
  `).run(user_id, JSON.stringify(toStore));

  log.info('Preferences updated', { user_id });
  return mergedPublic;
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
