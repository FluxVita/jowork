/**
 * settings/channel-settings.ts
 * 渠道密钥存储 — 专门用于 Telegram Bot Token、Figma Token 等渠道级密钥
 * 与 auth/settings.ts 的系统级 API Key 区分，支持 mask 展示
 */
import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('channel-settings');

const ALGORITHM = 'aes-256-gcm';
const CHANNEL_KEY = createHash('sha256').update(config.jwt_secret + ':channel_settings').digest();

// 支持的渠道密钥
export const CHANNEL_KEYS = [
  'telegram_bot_token',
  'figma_token',
] as const;

export type ChannelKeyName = typeof CHANNEL_KEYS[number];

/** mask 格式：取前 6 字符 + *** + 后 4 字符 */
function maskValue(value: string): string {
  if (value.length <= 10) return '***';
  return value.slice(0, 6) + '***' + value.slice(-4);
}

function ensureTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_settings (
      user_id     TEXT NOT NULL,
      channel_key TEXT NOT NULL,
      value_enc   TEXT NOT NULL,
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, channel_key)
    )
  `);
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, CHANNEL_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(encoded: string): string {
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const decipher = createDecipheriv(ALGORITHM, CHANNEL_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

/** 设置渠道密钥 */
export function setChannelKey(userId: string, channelKey: ChannelKeyName, value: string): void {
  ensureTable();
  const db = getDb();
  db.prepare(`
    INSERT INTO channel_settings (user_id, channel_key, value_enc)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, channel_key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = datetime('now')
  `).run(userId, channelKey, encrypt(value));
  log.info('Channel key set', { userId, channelKey });
}

/** 获取渠道密钥原文（内部使用） */
export function getChannelKey(userId: string, channelKey: ChannelKeyName): string | null {
  ensureTable();
  const db = getDb();
  const row = db.prepare(`SELECT value_enc FROM channel_settings WHERE user_id = ? AND channel_key = ?`)
    .get(userId, channelKey) as { value_enc: string } | undefined;
  if (!row) return null;
  try {
    return decrypt(row.value_enc);
  } catch {
    log.error(`Failed to decrypt channel key ${channelKey} for user ${userId}`);
    return null;
  }
}

/** 获取渠道密钥（mask 格式，用于 API 返回） */
export function getChannelKeyMasked(userId: string, channelKey: ChannelKeyName): { value_mask: string; is_set: true } | { is_set: false } {
  const value = getChannelKey(userId, channelKey);
  if (!value) return { is_set: false };
  return { value_mask: maskValue(value), is_set: true };
}

/** 列出当前用户所有渠道密钥（mask 格式） */
export function listChannelKeys(userId: string): Array<{ key: ChannelKeyName; value_mask: string; updated_at: string }> {
  ensureTable();
  const db = getDb();
  const rows = db.prepare(`SELECT channel_key, value_enc, updated_at FROM channel_settings WHERE user_id = ?`)
    .all(userId) as Array<{ channel_key: string; value_enc: string; updated_at: string }>;

  return rows.map(r => {
    let mask = '***';
    try {
      const plain = decrypt(r.value_enc);
      mask = maskValue(plain);
    } catch { /* ignore */ }
    return { key: r.channel_key as ChannelKeyName, value_mask: mask, updated_at: r.updated_at };
  });
}

/** 删除渠道密钥 */
export function deleteChannelKey(userId: string, channelKey: ChannelKeyName): void {
  ensureTable();
  const db = getDb();
  db.prepare(`DELETE FROM channel_settings WHERE user_id = ? AND channel_key = ?`).run(userId, channelKey);
}
