// @jowork/core/connectors/notion — Notion connector (JCP implementation)
//
// Connects to Notion databases, pages, and blocks.
// Uses Notion API v1 (no SDK dependency).
// Auth: Notion Integration Token.

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

interface NotionPage {
  id: string;
  url: string;
  last_edited_time: string;
  properties: Record<string, NotionProp>;
  parent: { type: string };
}

interface NotionProp {
  type: string;
  title?: Array<{ plain_text: string }>;
  rich_text?: Array<{ plain_text: string }>;
}

interface NotionBlock {
  type: string;
  [key: string]: unknown;
}

class NotionConnector implements JoworkConnector {
  readonly manifest: ConnectorManifest = {
    id: 'notion',
    name: 'Notion',
    version: '0.1.0',
    description: 'Connect to Notion pages, databases, and workspaces',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      properties: {
        databaseId: { type: 'string', title: 'Database ID', description: 'Notion database to sync (optional)' },
      },
    },
  };

  private token      = '';
  private databaseId = '';
  private apiUrl     = 'https://api.notion.com/v1';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.token      = credentials.apiKey ?? credentials.accessToken ?? '';
    this.databaseId = (config['databaseId'] as string) ?? '';
  }

  async shutdown(): Promise<void> {
    this.token = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res = await this.get('/users/me');
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    // Search for all pages the integration has access to
    const body: Record<string, unknown> = {
      filter: { property: 'object', value: 'page' },
      page_size: 50,
    };
    if (cursor) body['start_cursor'] = cursor;

    const res = await this.post('/search', body);
    if (!res.ok) throw new Error(`Notion discover error: ${res.status}`);

    const data = await res.json() as {
      results: NotionPage[];
      has_more: boolean;
      next_cursor: string | null;
    };

    const objects: DataObject[] = data.results.map(p => ({
      uri:       `notion:page:${p.id}`,
      name:      getPageTitle(p) || p.id,
      kind:      'page',
      url:       p.url,
      updatedAt: p.last_edited_time,
    }));

    const page: import('./protocol.js').DiscoverPage = { objects };
    if (data.has_more && data.next_cursor) page.nextCursor = data.next_cursor;
    return page;
  }

  async fetch(uri: string): Promise<FetchedContent> {
    const [, type, id] = uri.split(':');
    if (type !== 'page') throw new Error(`Unknown Notion URI type: ${type}`);
    return this.fetchPage(id ?? '');
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    const res = await this.post('/search', { query, page_size: limit, filter: { property: 'object', value: 'page' } });
    if (!res.ok) throw new Error(`Notion search error: ${res.status}`);

    const data = await res.json() as { results: NotionPage[] };
    return Promise.all(data.results.slice(0, limit).map(p => this.fetchPage(p.id)));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchPage(id: string): Promise<FetchedContent> {
    const [pageRes, blocksRes] = await Promise.all([
      this.get(`/pages/${id}`),
      this.get(`/blocks/${id}/children?page_size=100`),
    ]);

    if (!pageRes.ok) throw new Error(`Notion page fetch error: ${pageRes.status}`);

    const page   = await pageRes.json() as NotionPage;
    const title  = getPageTitle(page) || id;

    let content = '';
    if (blocksRes.ok) {
      const blocks = await blocksRes.json() as { results: NotionBlock[] };
      content = blocksToText(blocks.results);
    }

    return {
      uri:         `notion:page:${id}`,
      title,
      content:     content || `Page: ${title}`,
      contentType: 'text/plain',
      url:         page.url,
      updatedAt:   page.last_edited_time,
    };
  }

  private get(path: string): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      headers: {
        'authorization': `Bearer ${this.token}`,
        'notion-version': '2022-06-28',
      },
    });
  }

  private post(path: string, body: unknown): Promise<Response> {
    return fetch(`${this.apiUrl}${path}`, {
      method: 'POST',
      headers: {
        'authorization': `Bearer ${this.token}`,
        'content-type': 'application/json',
        'notion-version': '2022-06-28',
      },
      body: JSON.stringify(body),
    });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getPageTitle(page: NotionPage): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === 'title' && prop.title?.length) {
      return prop.title.map(t => t.plain_text).join('');
    }
  }
  return '';
}

function blocksToText(blocks: NotionBlock[]): string {
  return blocks
    .map(b => {
      const inner = b[b.type] as { rich_text?: Array<{ plain_text: string }> } | undefined;
      return inner?.rich_text?.map(t => t.plain_text).join('') ?? '';
    })
    .filter(Boolean)
    .join('\n');
}

/** Singleton Notion connector — register with registerJCPConnector() */
export const notionConnector = new NotionConnector();
