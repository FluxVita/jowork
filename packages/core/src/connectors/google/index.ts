/**
 * Google 统一 OAuth 连接器
 *
 * 一次授权，覆盖 Gmail + Google Drive + Google Calendar + Google Docs。
 * Token 存储在 key='google' 下，所有 Google 子连接器共享读取。
 *
 * UI 只需展示一个 "Connect Google" 按钮，
 * callback URL: /api/connectors/google/oauth/callback
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('google-connector');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// 一次性申请所有 Google 服务的 scope
const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/calendar.readonly',
  'https://www.googleapis.com/auth/documents.readonly',
].join(' ');

/** 读取 Google OAuth token（供所有子连接器使用） */
export function getGoogleToken(userId = 'system'): string {
  const creds = getOAuthCredentials('google', userId);
  if (!creds?.access_token) {
    throw new Error('Google not connected. Please authorize via "Connect Google".');
  }
  return creds.access_token;
}

/** 检查 Google 是否已授权 */
export function isGoogleAuthorized(userId = 'system'): boolean {
  try { getGoogleToken(userId); return true; } catch { return false; }
}

export class GoogleConnector implements Connector {
  readonly id = 'google';
  readonly source: DataSource = 'google_drive'; // 占位，实际数据由子连接器处理

  // ─── OAuth（统一入口）───

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.google;
    if (!client_id) throw new Error('GOOGLE_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPES,
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `${GOOGLE_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string, credentialUserId = 'system'): Promise<void> {
    const { client_id, client_secret } = config.google;
    if (!client_id || !client_secret) throw new Error('GOOGLE_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    }>(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id,
        client_secret,
        grant_type: 'authorization_code',
      }).toString(),
    });

    // 存在 'google' key 下，所有子连接器共享
    saveOAuthCredentials('google', {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      scope: resp.data.scope,
    }, credentialUserId);
    log.info(`Google OAuth token saved for ${credentialUserId} (scopes: ${resp.data.scope})`);
  }

  // 元连接器本身不索引数据，由子连接器负责
  async discover(): Promise<DataObject[]> { return []; }

  async fetch(_uri: string, _ctx: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    throw new Error('Use specific Google connectors (gmail, drive, calendar, docs) to fetch data.');
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    if (!isGoogleAuthorized()) return { ok: false, latency_ms: -1, error: 'Not authorized' };
    return { ok: true, latency_ms: 0 };
  }
}
