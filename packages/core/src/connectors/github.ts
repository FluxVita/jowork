// @jowork/core/connectors/github — GitHub connector (JCP implementation)
//
// Connects to GitHub repositories, issues, and pull requests.
// Uses GitHub REST API v3 (no SDK dependency).
// Auth: Personal Access Token (or OAuth2 token).

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  updated_at: string;
  private: boolean;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  updated_at: string;
  pull_request?: Record<string, unknown>;
}

class GitHubConnector implements JoworkConnector {
  // Public repos are 'public'; private repos are 'internal'. We default to
  // 'internal' since we can't know at manifest time. FetchedContent.sensitivity
  // can override per-item (e.g. private: true → 'confidential').
  readonly defaultSensitivity = 'internal' as const;

  readonly manifest: ConnectorManifest = {
    id: 'github',
    name: 'GitHub',
    version: '0.1.0',
    description: 'Connect to GitHub repositories, issues, and pull requests',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      properties: {
        org:   { type: 'string',  title: 'Organization',   description: 'GitHub org/user to connect' },
        repos: { type: 'array',   title: 'Repositories',   description: 'Specific repos (optional)' },
      },
    },
  };

  private token  = '';
  private org    = '';
  private apiUrl = 'https://api.github.com';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.token = credentials.apiKey ?? credentials.accessToken ?? '';
    this.org   = (config['org'] as string) ?? '';
  }

  async shutdown(): Promise<void> {
    this.token = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res = await this.get('/rate_limit');
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    let url = this.org
      ? `/orgs/${this.org}/repos?per_page=50&sort=updated&page=${cursor ?? '1'}`
      : `/user/repos?per_page=50&sort=updated&page=${cursor ?? '1'}`;

    if (!this.token) {
      // Public repos only — no auth needed
      url = this.org
        ? `/users/${this.org}/repos?per_page=50&sort=updated&page=${cursor ?? '1'}`
        : url;
    }

    const res = await this.get(url);
    if (!res.ok) throw new Error(`GitHub discover error: ${res.status}`);

    const repos = await res.json() as GitHubRepo[];
    const objects: DataObject[] = repos.map(r => ({
      uri:       `github:repo:${r.full_name}`,
      name:      r.full_name,
      kind:      'repository',
      url:       r.html_url,
      updatedAt: r.updated_at,
      metadata:  { private: r.private, description: r.description ?? '' },
    }));

    // Check for next page via Link header
    const link = res.headers.get('link') ?? '';
    const nextMatch = link.match(/page=(\d+)>;\s*rel="next"/);

    const page: import('./protocol.js').DiscoverPage = { objects };
    if (nextMatch?.[1]) page.nextCursor = nextMatch[1];
    return page;
  }

  async fetch(uri: string): Promise<FetchedContent> {
    // uri: "github:repo:owner/name" or "github:issue:owner/name/123"
    const [, type, ...rest] = uri.split(':');
    const ref = rest.join(':');

    if (type === 'repo') {
      return this.fetchRepo(ref);
    }
    if (type === 'issue') {
      return this.fetchIssue(ref);
    }

    throw new Error(`Unknown GitHub URI type: ${type}`);
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    const q = encodeURIComponent(this.org ? `${query} org:${this.org}` : query);
    const res = await this.get(`/search/issues?q=${q}&per_page=${limit}&type=Issues`);
    if (!res.ok) throw new Error(`GitHub search error: ${res.status}`);

    const data = await res.json() as { items: GitHubIssue[] };
    return data.items
      .filter(i => !i.pull_request) // Issues only
      .map(i => ({
        uri:         `github:issue:${i.html_url.split('github.com/')[1] ?? i.number}`,
        title:       `#${i.number}: ${i.title}`,
        content:     i.body ?? '(no body)',
        contentType: 'text/plain',
        url:         i.html_url,
        updatedAt:   i.updated_at,
      }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchRepo(fullName: string): Promise<FetchedContent> {
    const res = await this.get(`/repos/${fullName}/readme`);
    let content = '';
    if (res.ok) {
      const data = await res.json() as { content?: string; encoding?: string };
      if (data.content && data.encoding === 'base64') {
        content = Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8');
      }
    }
    return {
      uri:         `github:repo:${fullName}`,
      title:       fullName,
      content:     content || `Repository: ${fullName}`,
      contentType: 'text/markdown',
      url:         `https://github.com/${fullName}`,
    };
  }

  private async fetchIssue(ref: string): Promise<FetchedContent> {
    // ref: "owner/name/123"
    const parts = ref.split('/');
    const number = parts.pop();
    const repo   = parts.join('/');
    const res = await this.get(`/repos/${repo}/issues/${number}`);
    if (!res.ok) throw new Error(`GitHub issue fetch error: ${res.status}`);

    const issue = await res.json() as GitHubIssue;
    return {
      uri:         `github:issue:${ref}`,
      title:       `#${issue.number}: ${issue.title}`,
      content:     issue.body ?? '(no body)',
      contentType: 'text/plain',
      url:         issue.html_url,
      updatedAt:   issue.updated_at,
    };
  }

  private get(path: string): Promise<Response> {
    const headers: Record<string, string> = { 'accept': 'application/vnd.github+json' };
    if (this.token) headers['authorization'] = `Bearer ${this.token}`;
    return fetch(`${this.apiUrl}${path}`, { headers });
  }
}

/** Singleton GitHub connector — register with registerJCPConnector() */
export const githubConnector = new GitHubConnector();
