import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('discord-connector');
const CACHE_TTL_S = 300;

const DISCORD_AUTH_URL = 'https://discord.com/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_API = 'https://discord.com/api/v10';

async function discordGet<T>(path: string, token: string): Promise<T> {
  const res = await httpRequest<T>(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return res.data;
}

export class DiscordConnector implements Connector {
  readonly id = 'discord_v1';
  readonly source: DataSource = 'discord';

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.discord;
    if (!client_id) throw new Error('DISCORD_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'identify guilds guilds.members.read',
      state,
      prompt: 'consent',
    });
    return `${DISCORD_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.discord;
    if (!client_id || !client_secret) throw new Error('DISCORD_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      access_token: string;
      refresh_token?: string;
      expires_in: number;
      scope: string;
    }>(DISCORD_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id,
        client_secret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });

    saveOAuthCredentials('discord_v1', {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: Date.now() + resp.data.expires_in * 1000,
      scope: resp.data.scope,
    });
    log.info('Discord OAuth token saved');
  }

  private getToken(): string {
    const creds = getOAuthCredentials('discord_v1');
    if (!creds?.access_token) throw new Error('Discord not connected. Please authorize via OAuth.');
    return creds.access_token;
  }

  async discover(): Promise<DataObject[]> {
    let token: string;
    try { token = this.getToken(); } catch {
      log.warn('Discord not connected, skipping discovery');
      return [];
    }

    const objects: DataObject[] = [];
    try {
      interface Guild { id: string; name: string }
      const guilds = await discordGet<Guild[]>('/users/@me/guilds', token);

      for (const g of guilds ?? []) {
        const uri = `discord://guilds/${g.id}`;
        const obj: Partial<DataObject> = {
          uri,
          source: 'discord',
          source_type: 'channel',
          title: g.name,
          sensitivity: 'internal',
          tags: ['discord', 'guild'],
          connector_id: this.id,
          acl: { read: ['role:all_staff'] },
        };
        await upsertObject(obj as DataObject);
        objects.push(obj as DataObject);
      }
    } catch (err) {
      log.error('Discord discovery failed', err);
    }

    return objects;
  }

  async fetch(uri: string, _userContext: { user_id: string; role: Role }): Promise<{ content: string; content_type: string; cached: boolean }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const match = uri.match(/^discord:\/\/guilds\/(.+)$/);
    if (!match) throw new Error(`Invalid Discord URI: ${uri}`);

    const token = this.getToken();
    interface Guild { id: string; name: string; owner?: boolean }
    const guild = await discordGet<Guild>(`/guilds/${match[1]}`, token);
    const content = `# ${guild.name}\n\nGuild ID: ${guild.id}\nOwner: ${guild.owner ? 'yes' : 'no'}`;

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    try {
      const token = this.getToken();
      const t0 = Date.now();
      await discordGet('/users/@me', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: -1, error: String(err) };
    }
  }
}
