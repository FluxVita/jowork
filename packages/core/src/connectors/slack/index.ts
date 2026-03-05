/**
 * Slack Connector
 *
 * 通过 Slack OAuth 2.0 授权，索引 Slack 频道消息。
 * System 级授权（Admin 配置一次，全团队共享工作区数据）。
 *
 * 环境变量：
 *   SLACK_CLIENT_ID     — Slack App Client ID
 *   SLACK_CLIENT_SECRET — Slack App Client Secret
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('slack-connector');

const SLACK_AUTH_URL = 'https://slack.com/oauth/v2/authorize';
const SLACK_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
const SLACK_API = 'https://slack.com/api';
const CACHE_TTL_S = 300;

async function slackGet<T>(method: string, token: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? '?' + new URLSearchParams(params) : '';
  const res = await httpRequest<T & { ok: boolean; error?: string }>(`${SLACK_API}/${method}${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.data.ok) throw new Error(`Slack API error: ${res.data.error}`);
  return res.data;
}

export class SlackConnector implements Connector {
  readonly id = 'slack_v1';
  readonly source: DataSource = 'slack' as DataSource;

  // ─── OAuth ───

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.slack;
    if (!client_id) throw new Error('SLACK_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      scope: 'channels:read,channels:history,users:read',
      state,
    });
    return `${SLACK_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.slack;
    if (!client_id || !client_secret) throw new Error('SLACK_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      ok: boolean;
      access_token: string;
      scope: string;
      team?: { id: string; name: string };
      error?: string;
    }>(SLACK_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id,
        client_secret,
      }).toString(),
    });

    if (!resp.data.ok) throw new Error(`Slack OAuth failed: ${resp.data.error}`);

    saveOAuthCredentials('slack_v1', {
      access_token: resp.data.access_token,
      scope: resp.data.scope,
      extra: { team: resp.data.team },
    });
    log.info('Slack OAuth token saved');
  }

  private getToken(): string {
    const creds = getOAuthCredentials('slack_v1');
    if (!creds?.access_token) throw new Error('Slack not connected. Please authorize via OAuth.');
    return creds.access_token;
  }

  // ─── Connector 接口 ───

  async discover(): Promise<DataObject[]> {
    let token: string;
    try { token = this.getToken(); } catch {
      log.warn('Slack not connected, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      interface SlackChannel { id: string; name: string; is_member: boolean }
      interface SlackListResp { channels: SlackChannel[] }
      const list = await slackGet<SlackListResp>('conversations.list', token, {
        types: 'public_channel',
        limit: '50',
      });

      for (const ch of list.channels) {
        if (!ch.is_member) continue;
        const uri = `slack://channels/${ch.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'slack' as DataSource,
          source_type: 'channel',
          title: `#${ch.name}`,
          sensitivity: 'internal',
          tags: ['slack', 'channel'],
          connector_id: this.id,
          acl: { read: ['role:all_staff'] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Slack discovery failed', err);
    }
    return objects;
  }

  async fetch(uri: string, _userContext: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^slack:\/\/channels\/(.+)$/);
    if (!match) throw new Error(`Invalid Slack URI: ${uri}`);

    const [, channelId] = match;
    const token = this.getToken();

    interface SlackMsg { text: string; ts: string; user?: string }
    interface SlackHistoryResp { messages: SlackMsg[] }
    const hist = await slackGet<SlackHistoryResp>('conversations.history', token, {
      channel: channelId,
      limit: '50',
    });

    const content = hist.messages
      .map(m => `[${new Date(parseFloat(m.ts) * 1000).toISOString()}] ${m.user ?? 'unknown'}: ${m.text}`)
      .join('\n');

    cacheSet(uri, content, 'text/plain', CACHE_TTL_S);
    return { content, content_type: 'text/plain', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = this.getToken();
      const t0 = Date.now();
      await slackGet('auth.test', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}
