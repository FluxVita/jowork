// @jowork/core/connectors/confluence — Confluence connector (JCP implementation)
//
// Connects to Confluence Cloud or Server/Data Center.
// Discovers pages and blog posts, fetches full content, supports CQL search.
// Auth: API Token + email (Confluence Cloud) or PAT (Confluence Server).
//
// Config:
//   baseUrl   — Confluence instance URL, e.g. "https://mycompany.atlassian.net/wiki"
//   spaceKey  — Optional: limit discover to a specific space (e.g. "ENG")

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

// ─── Confluence API types ─────────────────────────────────────────────────────

interface ConfluencePage {
  id: string;
  title: string;
  type: 'page' | 'blogpost';
  status: string;
  space: { key: string; name: string };
  version: { when: string; by?: { displayName: string } };
  _links: { webui: string };
}

interface ConfluencePageBody {
  id: string;
  title: string;
  type: string;
  space: { key: string; name: string };
  version: { when: string; by?: { displayName: string } };
  body: {
    storage?: { value: string; representation: string };
    view?: { value: string; representation: string };
  };
  _links: { webui: string };
}

interface ConfluenceSearchResult {
  results: Array<{
    content: ConfluencePage;
    excerpt?: string;
    lastModified?: string;
  }>;
  totalSize: number;
  start: number;
  limit: number;
}

interface ConfluencePaginatedPages {
  results: ConfluencePage[];
  size: number;
  start: number;
  limit: number;
  _links: { next?: string };
}

// ─── HTML → plain text helper ─────────────────────────────────────────────────

function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')   // strip tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Connector implementation ─────────────────────────────────────────────────

class ConfluenceConnector implements JoworkConnector {
  readonly defaultSensitivity = 'confidential' as const;

  readonly manifest: ConnectorManifest = {
    id: 'confluence',
    name: 'Confluence',
    version: '0.1.0',
    description: 'Connect to Confluence spaces, pages, and blog posts (Cloud or Server)',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      required: ['baseUrl'],
      properties: {
        baseUrl: {
          type: 'string',
          title: 'Confluence URL',
          description: 'Your Confluence base URL (e.g. https://mycompany.atlassian.net/wiki)',
        },
        spaceKey: {
          type: 'string',
          title: 'Space Key',
          description: 'Limit to a specific space (e.g. "ENG"). Leave empty for all spaces.',
        },
        email: {
          type: 'string',
          title: 'Email',
          description: 'Atlassian account email (required for Cloud API token auth)',
        },
      },
    },
  };

  private baseUrl   = '';
  private email     = '';
  private apiToken  = '';
  private spaceKey  = '';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.baseUrl  = ((config['baseUrl'] as string) ?? '').replace(/\/$/, '');
    this.spaceKey = (config['spaceKey'] as string) ?? '';
    this.email    = (config['email'] as string) ?? '';
    this.apiToken = credentials.apiKey ?? credentials.accessToken ?? '';
  }

  async shutdown(): Promise<void> {
    this.apiToken = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res = await this.get('/rest/api/user/current');
      if (!res.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    const start   = cursor ? parseInt(cursor, 10) : 0;
    const limit   = 50;

    const params = new URLSearchParams({
      start: String(start),
      limit: String(limit),
      expand: 'space,version',
      orderby: 'history.lastUpdated desc',
    });

    if (this.spaceKey) {
      params.set('spaceKey', this.spaceKey);
    }

    const res = await this.get(`/rest/api/content?${params.toString()}`);
    if (!res.ok) throw new Error(`Confluence discover error: HTTP ${res.status}`);

    const data = await res.json() as ConfluencePaginatedPages;

    const objects: DataObject[] = data.results.map(page => ({
      uri:      `confluence:page:${page.id}`,
      name:     `[${page.space.key}] ${page.title}`,
      kind:     page.type === 'blogpost' ? 'document' : 'page',
      url:      `${this.baseUrl}${page._links.webui}`,
      updatedAt: page.version.when,
      metadata: {
        space:  page.space.name,
        type:   page.type,
        author: page.version.by?.displayName ?? null,
      },
    }));

    const nextStart = start + data.results.length;
    const hasMore   = data._links.next != null;

    return {
      objects,
      ...(hasMore ? { nextCursor: String(nextStart) } : {}),
    };
  }

  async fetch(uri: string): Promise<FetchedContent> {
    const [, type, id] = uri.split(':');
    if (type !== 'page') throw new Error(`Unknown Confluence URI type: ${type}`);

    const res = await this.get(`/rest/api/content/${id}?expand=body.view,space,version`);
    if (!res.ok) throw new Error(`Confluence fetch error: HTTP ${res.status}`);

    const page = await res.json() as ConfluencePageBody;

    const rawHtml  = page.body.view?.value ?? page.body.storage?.value ?? '';
    const textBody = rawHtml ? htmlToText(rawHtml) : '(no content)';

    const lines = [
      `**Space**: ${page.space.name} (${page.space.key})`,
      `**Type**: ${page.type}`,
      page.version.by ? `**Author**: ${page.version.by.displayName}` : null,
      '',
      textBody,
    ].filter((l): l is string => l !== null);

    return {
      uri:         `confluence:page:${page.id}`,
      title:       `[${page.space.key}] ${page.title}`,
      content:     lines.join('\n'),
      contentType: 'text/plain',
      url:         `${this.baseUrl}${page._links.webui}`,
      updatedAt:   page.version.when,
    };
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    // CQL (Confluence Query Language) full-text search
    const cql = this.spaceKey
      ? `space = "${this.spaceKey}" AND text ~ "${query.replace(/"/g, '\\"')}"`
      : `text ~ "${query.replace(/"/g, '\\"')}"`;

    const params = new URLSearchParams({
      cql,
      limit: String(Math.min(limit, 50)),
      expand: 'content.space,content.version',
    });

    const res = await this.get(`/rest/api/search?${params.toString()}`);
    if (!res.ok) throw new Error(`Confluence search error: HTTP ${res.status}`);

    const data = await res.json() as ConfluenceSearchResult;

    return data.results.map(r => ({
      uri:         `confluence:page:${r.content.id}`,
      title:       `[${r.content.space.key}] ${r.content.title}`,
      content:     r.excerpt ? htmlToText(r.excerpt) : '(no excerpt)',
      contentType: 'text/plain',
      url:         `${this.baseUrl}${r.content._links.webui}`,
      updatedAt:   r.lastModified ?? r.content.version.when,
    }));
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private get(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'accept':       'application/json',
      'content-type': 'application/json',
    };

    if (this.email) {
      const creds = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
      headers['authorization'] = `Basic ${creds}`;
    } else {
      headers['authorization'] = `Bearer ${this.apiToken}`;
    }

    return fetch(url, { headers });
  }
}

/** Singleton Confluence connector — registered automatically via connectors/index.ts */
export const confluenceConnector = new ConfluenceConnector();
