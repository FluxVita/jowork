/**
 * OAuth 凭证存储
 *
 * 使用 AES-256-GCM 加密存入 connector_oauth 表。
 * 支持 system 级（管理员配置一次全团队用）和 per-user 级（每人授权自己账号）。
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getDb } from '../datamap/db.js';
import { config } from '../config.js';

const ALGORITHM = 'aes-256-gcm';
const OAUTH_KEY = createHash('sha256').update(config.jwt_secret + ':connector_oauth').digest();

function encrypt(plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv(ALGORITHM, OAUTH_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

function decrypt(encoded: string): string {
  const data = Buffer.from(encoded, 'base64');
  const iv = data.subarray(0, 16);
  const authTag = data.subarray(16, 32);
  const encrypted = data.subarray(32);
  const decipher = createDecipheriv(ALGORITHM, OAUTH_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf-8');
}

export interface OAuthCredentials {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  scope?: string;
  extra?: Record<string, unknown>;
}

/** 存储 OAuth 凭证（UPSERT） */
export function saveOAuthCredentials(
  connectorId: string,
  creds: OAuthCredentials,
  userId = 'system',
): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO connector_oauth
      (connector_id, user_id, access_token_enc, refresh_token_enc, expires_at, scope, extra_enc, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(connector_id, user_id) DO UPDATE SET
      access_token_enc  = excluded.access_token_enc,
      refresh_token_enc = excluded.refresh_token_enc,
      expires_at        = excluded.expires_at,
      scope             = excluded.scope,
      extra_enc         = excluded.extra_enc,
      updated_at        = datetime('now')
  `).run(
    connectorId,
    userId,
    encrypt(creds.access_token),
    creds.refresh_token ? encrypt(creds.refresh_token) : null,
    creds.expires_at ?? null,
    creds.scope ?? null,
    creds.extra ? encrypt(JSON.stringify(creds.extra)) : null,
  );
}

/** 读取 OAuth 凭证（返回 null 表示未授权） */
export function getOAuthCredentials(
  connectorId: string,
  userId = 'system',
): OAuthCredentials | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT access_token_enc, refresh_token_enc, expires_at, scope, extra_enc
    FROM connector_oauth
    WHERE connector_id = ? AND user_id = ?
  `).get(connectorId, userId) as {
    access_token_enc: string;
    refresh_token_enc: string | null;
    expires_at: number | null;
    scope: string | null;
    extra_enc: string | null;
  } | undefined;

  if (!row) return null;

  try {
    return {
      access_token: decrypt(row.access_token_enc),
      refresh_token: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : undefined,
      expires_at: row.expires_at ?? undefined,
      scope: row.scope ?? undefined,
      extra: row.extra_enc ? JSON.parse(decrypt(row.extra_enc)) : undefined,
    };
  } catch {
    return null;
  }
}

/** 删除 OAuth 凭证（断开连接） */
export function deleteOAuthCredentials(connectorId: string, userId = 'system'): void {
  const db = getDb();
  db.prepare('DELETE FROM connector_oauth WHERE connector_id = ? AND user_id = ?')
    .run(connectorId, userId);
}

/** 检查是否已授权（且 token 未过期） */
export function isOAuthAuthorized(connectorId: string, userId = 'system'): boolean {
  const creds = getOAuthCredentials(connectorId, userId);
  if (!creds) return false;
  if (creds.expires_at && creds.expires_at < Date.now()) return false;
  return true;
}

/** 列出所有已授权的 connector（system 级） */
export function listAuthorizedConnectors(): { connector_id: string; scope: string | null; updated_at: string }[] {
  const db = getDb();
  return db.prepare(`
    SELECT connector_id, scope, updated_at
    FROM connector_oauth
    WHERE user_id = 'system'
    ORDER BY updated_at DESC
  `).all() as { connector_id: string; scope: string | null; updated_at: string }[];
}

/** 列出所有用户已授权过的 connector_id（去重） */
export function listAuthorizedConnectorIdsAllUsers(): string[] {
  const db = getDb();
  const rows = db.prepare(`
    SELECT DISTINCT connector_id
    FROM connector_oauth
  `).all() as { connector_id: string }[];
  return rows.map(r => r.connector_id);
}
