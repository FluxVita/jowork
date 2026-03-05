/**
 * Outlook / Microsoft 365 Connector
 *
 * 通过 Microsoft OAuth 2.0 授权，索引用户 Outlook 收件箱。
 * Per-user 授权：每个用户需单独授权自己的 Microsoft 账号。
 *
 * 环境变量：
 *   MICROSOFT_CLIENT_ID     — Azure AD App Client ID
 *   MICROSOFT_CLIENT_SECRET — Azure AD App Client Secret
 *   MICROSOFT_TENANT_ID     — 租户 ID（默认 'common'，即支持任意 Microsoft 账号）
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('outlook-connector');

const GRAPH_API = 'https://graph.microsoft.com/v1.0';
const CACHE_TTL_S = 300;

function authUrl(): string {
  const tenant = config.microsoft.tenant_id || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize`;
}

function tokenUrl(): string {
  const tenant = config.microsoft.tenant_id || 'common';
  return `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`;
}

async function msGet<T>(path: string, token: string): Promise<T> {
  const res = await httpRequest<T>(`${GRAPH_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export class OutlookConnector implements Connector {
  readonly id = 'outlook_v1';
  readonly source: DataSource = 'email';

  // ─── OAuth ───

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.microsoft;
    if (!client_id) throw new Error('MICROSOFT_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'Mail.Read offline_access',
      state,
    });
    return `${authUrl()}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string, credentialUserId = 'system'): Promise<void> {
    const { client_id, client_secret } = config.microsoft;
    if (!client_id || !client_secret) throw new Error('MICROSOFT_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    }>(tokenUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id,
        client_secret,
        grant_type: 'authorization_code',
        scope: 'Mail.Read offline_access',
      }).toString(),
    });

    saveOAuthCredentials('outlook_v1', {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      scope: resp.data.scope,
    }, credentialUserId);
    log.info(`Outlook OAuth token saved for ${credentialUserId}`);
  }

  private getToken(userId = 'system'): string {
    const creds = getOAuthCredentials('outlook_v1', userId);
    if (!creds?.access_token) throw new Error('Outlook not connected. Please authorize via OAuth.');
    return creds.access_token;
  }

  // ─── Connector 接口 ───

  async discover(userId = 'system'): Promise<DataObject[]> {
    let token: string;
    try { token = this.getToken(userId); } catch {
      log.warn('Outlook not connected, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      interface MsMsg { id: string; subject: string; receivedDateTime: string; from?: { emailAddress?: { address: string } } }
      interface MsListResp { value: MsMsg[] }
      const list = await msGet<MsListResp>('/me/messages?$top=50&$select=id,subject,receivedDateTime,from', token);
      for (const msg of list.value ?? []) {
        const uri = `outlook://me/messages/${msg.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'email',
          source_type: 'email',
          title: msg.subject || '(no subject)',
          sensitivity: 'internal',
          tags: ['outlook', 'inbox'],
          updated_at: msg.receivedDateTime,
          connector_id: this.id,
          acl: { read: [`user:${userId}`] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Outlook discovery failed', err);
    }
    return objects;
  }

  async fetch(uri: string, userContext: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^outlook:\/\/me\/messages\/(.+)$/);
    if (!match) throw new Error(`Invalid Outlook URI: ${uri}`);

    const [, msgId] = match;
    const token = this.getToken(userContext.user_id);

    interface MsMsg { subject: string; bodyPreview: string; from?: { emailAddress?: { address: string } }; receivedDateTime: string }
    const msg = await msGet<MsMsg>(`/me/messages/${msgId}`, token);
    const content = `# ${msg.subject}\n\n**From:** ${msg.from?.emailAddress?.address ?? ''}\n**Date:** ${msg.receivedDateTime}\n\n${msg.bodyPreview}`;

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = this.getToken();
      const t0 = Date.now();
      await msGet('/me', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}
