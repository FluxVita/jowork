import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('confluence-connector');
const CACHE_TTL_S = 300;

const ATLASSIAN_AUTH_URL = 'https://auth.atlassian.com/authorize';
const ATLASSIAN_TOKEN_URL = 'https://auth.atlassian.com/oauth/token';
const ATLASSIAN_AUDIENCE = 'api.atlassian.com';

function confApiBase(): string {
  if (!config.atlassian.cloud_id) throw new Error('ATLASSIAN_CLOUD_ID not configured');
  return `https://api.atlassian.com/ex/confluence/${config.atlassian.cloud_id}/wiki/api/v2`;
}

async function confGet<T>(path: string, token: string): Promise<T> {
  const res = await httpRequest<T>(`${confApiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  return res.data;
}

export class ConfluenceConnector implements Connector {
  readonly id = 'confluence_v1';
  readonly source: DataSource = 'confluence';

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.atlassian;
    if (!client_id) throw new Error('ATLASSIAN_CLIENT_ID not configured');
    const params = new URLSearchParams({
      audience: ATLASSIAN_AUDIENCE,
      client_id,
      scope: 'read:confluence-content.summary read:confluence-content.all offline_access',
      redirect_uri: redirectUri,
      response_type: 'code',
      prompt: 'consent',
      state,
    });
    return `${ATLASSIAN_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.atlassian;
    if (!client_id || !client_secret) throw new Error('ATLASSIAN_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    }>(ATLASSIAN_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id,
        client_secret,
        code,
        redirect_uri: redirectUri,
      }),
    });

    saveOAuthCredentials('confluence_v1', {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      scope: resp.data.scope,
    });
    log.info('Confluence OAuth token saved');
  }

  private getToken(): string {
    const creds = getOAuthCredentials('confluence_v1');
    if (!creds?.access_token) throw new Error('Confluence not connected. Please authorize via OAuth.');
    return creds.access_token;
  }

  async discover(): Promise<DataObject[]> {
    let token: string;
    try { token = this.getToken(); } catch {
      log.warn('Confluence not connected, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      interface ConfluencePage { id: string; title: string }
      interface ConfluenceResp { results: ConfluencePage[] }
      const data = await confGet<ConfluenceResp>('/pages?limit=50', token);

      for (const page of data.results ?? []) {
        const uri = `confluence://pages/${page.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'confluence',
          source_type: 'wiki',
          title: page.title,
          sensitivity: 'internal',
          tags: ['confluence', 'wiki'],
          connector_id: this.id,
          acl: { read: ['role:all_staff'] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Confluence discovery failed', err);
    }

    return objects;
  }

  async fetch(uri: string, _userContext: { user_id: string; role: Role }): Promise<{ content: string; content_type: string; cached: boolean }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^confluence:\/\/pages\/(.+)$/);
    if (!match) throw new Error(`Invalid Confluence URI: ${uri}`);
    const [, pageId] = match;

    const token = this.getToken();
    interface ConfluencePageResp {
      id: string;
      title: string;
      body?: { storage?: { value?: string } };
    }
    const page = await confGet<ConfluencePageResp>(`/pages/${pageId}?body-format=storage`, token);
    const content = `# ${page.title}\n\n${page.body?.storage?.value ?? ''}`;

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = this.getToken();
      const t0 = Date.now();
      await confGet('/spaces?limit=1', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}
