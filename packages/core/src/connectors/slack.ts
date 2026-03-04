// @jowork/core/connectors/slack — Slack connector (JCP implementation)
//
// Connects to Slack workspaces, channels, and messages.
// Uses Slack Web API (no SDK dependency).
// Auth: Bot OAuth Token (xoxb-...) — scopes: channels:read, channels:history, search:read

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

interface SlackChannel {
  id: string;
  name: string;
  is_private: boolean;
  topic?: { value: string };
  purpose?: { value: string };
  updated?: number;
  num_members?: number;
}

interface SlackMessage {
  ts: string;
  text: string;
  user?: string;
  username?: string;
  thread_ts?: string;
  reply_count?: number;
}

interface SlackSearchMatch {
  channel: { id: string; name: string };
  ts: string;
  text: string;
  permalink: string;
  username?: string;
}

class SlackConnector implements JoworkConnector {
  // Slack content is workspace-internal by default
  readonly defaultSensitivity = 'internal' as const;

  readonly manifest: ConnectorManifest = {
    id: 'slack',
    name: 'Slack',
    version: '0.1.0',
    description: 'Connect to Slack channels and messages',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      properties: {
        channelIds: {
          type: 'array',
          items: { type: 'string' },
          title: 'Channel IDs',
          description: 'Specific channel IDs to sync (optional — defaults to all public channels)',
        },
      },
    },
  };

  private token      = '';
  private channelIds: string[] = [];
  private apiUrl     = 'https://slack.com/api';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.token      = credentials.apiKey ?? credentials.accessToken ?? '';
    this.channelIds = (config['channelIds'] as string[] | undefined) ?? [];
  }

  async shutdown(): Promise<void> {
    this.token = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res = await this.get('/auth.test');
      const data = await res.json() as { ok: boolean; error?: string };
      if (!data.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: data.error ?? 'auth.test failed' };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    // If specific channel IDs configured, return them directly
    if (this.channelIds.length > 0 && !cursor) {
      const objects: DataObject[] = this.channelIds.map(id => ({
        uri:  `slack:channel:${id}`,
        name: `#${id}`,
        kind: 'channel',
      }));
      return { objects };
    }

    const params = new URLSearchParams({ limit: '200', types: 'public_channel,private_channel' });
    if (cursor) params.set('cursor', cursor);

    const res  = await this.get(`/conversations.list?${params}`);
    const data = await res.json() as {
      ok: boolean;
      channels: SlackChannel[];
      response_metadata?: { next_cursor?: string };
      error?: string;
    };

    if (!data.ok) throw new Error(`Slack discover error: ${data.error ?? 'unknown'}`);

    const objects: DataObject[] = data.channels.map(ch => ({
      uri:      `slack:channel:${ch.id}`,
      name:     `#${ch.name}`,
      kind:     'channel',
      metadata: {
        is_private:  ch.is_private,
        topic:       ch.topic?.value ?? '',
        purpose:     ch.purpose?.value ?? '',
        num_members: ch.num_members ?? 0,
      },
    }));

    const page: DiscoverPage = { objects };
    const nextCursor = data.response_metadata?.next_cursor;
    if (nextCursor) page.nextCursor = nextCursor;
    return page;
  }

  async fetch(uri: string): Promise<FetchedContent> {
    // uri: "slack:channel:C12345" or "slack:message:C12345/1234567890.123456"
    const [, type, ref] = uri.split(':');

    if (type === 'channel') {
      return this.fetchChannel(ref ?? '');
    }
    if (type === 'message') {
      const [channelId, ts] = (ref ?? '').split('/');
      return this.fetchMessage(channelId ?? '', ts ?? '');
    }

    throw new Error(`Unknown Slack URI type: ${type}`);
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    const params = new URLSearchParams({ query, count: String(limit), highlight: 'false' });
    const res    = await this.get(`/search.messages?${params}`);
    const data   = await res.json() as {
      ok: boolean;
      messages?: { matches: SlackSearchMatch[] };
      error?: string;
    };

    if (!data.ok) throw new Error(`Slack search error: ${data.error ?? 'unknown'}`);

    const matches = data.messages?.matches ?? [];
    return matches.slice(0, limit).map(m => ({
      uri:         `slack:message:${m.channel.id}/${m.ts}`,
      title:       `#${m.channel.name} — ${m.username ?? 'unknown'}`,
      content:     m.text,
      contentType: 'text/plain',
      url:         m.permalink,
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchChannel(channelId: string): Promise<FetchedContent> {
    // Fetch recent messages from channel (last 50)
    const params = new URLSearchParams({ channel: channelId, limit: '50' });
    const res    = await this.get(`/conversations.history?${params}`);
    const data   = await res.json() as {
      ok: boolean;
      messages: SlackMessage[];
      error?: string;
    };

    if (!data.ok) throw new Error(`Slack channel history error: ${data.error ?? 'unknown'}`);

    // Get channel info for the name
    const infoRes = await this.get(`/conversations.info?channel=${channelId}`);
    const infoData = await infoRes.json() as { ok: boolean; channel?: SlackChannel };
    const channelName = infoData.channel?.name ?? channelId;

    const content = data.messages
      .reverse() // oldest first
      .map(m => `[${new Date(parseFloat(m.ts) * 1000).toISOString()}] ${m.username ?? m.user ?? 'user'}: ${m.text}`)
      .join('\n');

    return {
      uri:         `slack:channel:${channelId}`,
      title:       `#${channelName}`,
      content:     content || `Channel: #${channelName} (no recent messages)`,
      contentType: 'text/plain',
      url:         `https://slack.com/app_redirect?channel=${channelId}`,
    };
  }

  private async fetchMessage(channelId: string, ts: string): Promise<FetchedContent> {
    const params = new URLSearchParams({ channel: channelId, latest: ts, oldest: ts, inclusive: 'true', limit: '1' });
    const res    = await this.get(`/conversations.history?${params}`);
    const data   = await res.json() as { ok: boolean; messages: SlackMessage[]; error?: string };

    if (!data.ok) throw new Error(`Slack message fetch error: ${data.error ?? 'unknown'}`);

    const msg = data.messages[0];
    if (!msg) throw new Error(`Slack message not found: ${channelId}/${ts}`);

    return {
      uri:         `slack:message:${channelId}/${ts}`,
      title:       `Slack message from ${msg.username ?? msg.user ?? 'user'}`,
      content:     msg.text,
      contentType: 'text/plain',
    };
  }

  private get(path: string): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      headers: {
        'authorization': `Bearer ${this.token}`,
        'content-type':  'application/json; charset=utf-8',
      },
    });
  }
}

/** Singleton Slack connector — registered automatically via connectors/index.ts */
export const slackConnector = new SlackConnector();
