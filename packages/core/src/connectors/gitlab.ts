// @jowork/core/connectors/gitlab — GitLab connector (JCP implementation)
//
// Connects to GitLab: projects, merge requests, issues.
// Uses GitLab REST API v4 (no SDK dependency).
// Auth: Personal Access Token or OAuth token (scopes: read_api).

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

interface GitLabProject {
  id: number;
  path_with_namespace: string;
  name: string;
  description: string | null;
  web_url: string;
  last_activity_at: string;
  visibility: 'private' | 'internal' | 'public';
}

interface GitLabMR {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  updated_at: string;
  author: { name: string };
  target_branch: string;
  source_branch: string;
}

interface GitLabIssue {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  updated_at: string;
  author: { name: string };
  labels: string[];
}

class GitLabConnector implements JoworkConnector {
  // Private GitLab projects are confidential; public are internal
  readonly defaultSensitivity = 'internal' as const;

  readonly manifest: ConnectorManifest = {
    id: 'gitlab',
    name: 'GitLab',
    version: '0.1.0',
    description: 'Connect to GitLab repositories, merge requests, and issues',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      properties: {
        baseUrl: {
          type: 'string',
          title: 'GitLab Base URL',
          description: 'GitLab instance URL (default: https://gitlab.com)',
        },
        groupId: {
          type: 'string',
          title: 'Group or Namespace',
          description: 'GitLab group/namespace to list projects from (optional)',
        },
      },
    },
  };

  private token   = '';
  private baseUrl = 'https://gitlab.com';
  private groupId = '';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.token   = credentials.apiKey ?? credentials.accessToken ?? '';
    this.baseUrl = ((config['baseUrl'] as string) ?? 'https://gitlab.com').replace(/\/$/, '');
    this.groupId = (config['groupId'] as string) ?? '';
  }

  async shutdown(): Promise<void> {
    this.token = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res = await this.get('/user');
      if (!res.ok) return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    const page = cursor ? parseInt(cursor, 10) : 1;
    const path = this.groupId
      ? `/groups/${encodeURIComponent(this.groupId)}/projects?per_page=50&page=${page}&order_by=last_activity_at&sort=desc`
      : `/projects?membership=true&per_page=50&page=${page}&order_by=last_activity_at&sort=desc`;

    const res  = await this.get(path);
    if (!res.ok) throw new Error(`GitLab discover error: HTTP ${res.status}`);

    const projects = await res.json() as GitLabProject[];
    const objects: DataObject[] = projects.map(p => ({
      uri:      `gitlab:project:${p.id}`,
      name:     p.path_with_namespace,
      kind:     'repository',
      url:      p.web_url,
      updatedAt: p.last_activity_at,
      metadata: {
        description: p.description ?? '',
        visibility:  p.visibility,
      },
    }));

    // GitLab pagination via X-Next-Page header
    const nextPage = res.headers.get('x-next-page');
    return {
      objects,
      ...(nextPage ? { nextCursor: nextPage } : {}),
    };
  }

  async fetch(uri: string): Promise<FetchedContent> {
    const [, type, ...rest] = uri.split(':');
    const ref = rest.join(':');

    if (type === 'project') return this.fetchProject(ref ?? '');
    if (type === 'mr')      return this.fetchMR(ref ?? '');
    if (type === 'issue')   return this.fetchIssue(ref ?? '');

    throw new Error(`Unknown GitLab URI type: ${type}`);
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    // Search across all accessible projects' issues and MRs
    const q = encodeURIComponent(query);
    const res = await this.get(`/search?scope=issues&search=${q}&per_page=${limit}`);
    if (!res.ok) throw new Error(`GitLab search error: HTTP ${res.status}`);

    const issues = await res.json() as GitLabIssue[];
    return issues.slice(0, limit).map(i => ({
      uri:         `gitlab:issue:${i.iid}`,
      title:       `#${i.iid}: ${i.title}`,
      content:     i.description ?? '(no description)',
      contentType: 'text/plain',
      url:         i.web_url,
      updatedAt:   i.updated_at,
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async fetchProject(projectId: string): Promise<FetchedContent> {
    const res = await this.get(`/projects/${projectId}/repository/files/README.md/raw?ref=HEAD`);
    let content = '';
    if (res.ok) {
      content = await res.text();
    }

    const infoRes = await this.get(`/projects/${projectId}`);
    const info    = infoRes.ok ? await infoRes.json() as GitLabProject : null;
    const name    = info?.path_with_namespace ?? projectId;

    return {
      uri:         `gitlab:project:${projectId}`,
      title:       name,
      content:     content || `Project: ${name}`,
      contentType: 'text/markdown',
      url:         info?.web_url ?? `${this.baseUrl}/${name}`,
    };
  }

  private async fetchMR(ref: string): Promise<FetchedContent> {
    // ref: "projectId/mrIid"
    const [projectId, iid] = ref.split('/');
    const res = await this.get(`/projects/${projectId}/merge_requests/${iid}`);
    if (!res.ok) throw new Error(`GitLab MR fetch error: HTTP ${res.status}`);

    const mr = await res.json() as GitLabMR;
    const content = [
      `**State**: ${mr.state}`,
      `**Author**: ${mr.author.name}`,
      `**Branch**: \`${mr.source_branch}\` → \`${mr.target_branch}\``,
      '',
      mr.description ?? '(no description)',
    ].join('\n');

    return {
      uri:         `gitlab:mr:${ref}`,
      title:       `!${mr.iid}: ${mr.title}`,
      content,
      contentType: 'text/markdown',
      url:         mr.web_url,
      updatedAt:   mr.updated_at,
    };
  }

  private async fetchIssue(ref: string): Promise<FetchedContent> {
    // ref: "projectId/issueIid"
    const [projectId, iid] = ref.split('/');
    const res = await this.get(`/projects/${projectId}/issues/${iid}`);
    if (!res.ok) throw new Error(`GitLab issue fetch error: HTTP ${res.status}`);

    const issue = await res.json() as GitLabIssue;
    const content = [
      `**State**: ${issue.state}`,
      `**Author**: ${issue.author.name}`,
      issue.labels.length ? `**Labels**: ${issue.labels.join(', ')}` : null,
      '',
      issue.description ?? '(no description)',
    ].filter(l => l !== null).join('\n');

    return {
      uri:         `gitlab:issue:${ref}`,
      title:       `#${issue.iid}: ${issue.title}`,
      content,
      contentType: 'text/markdown',
      url:         issue.web_url,
      updatedAt:   issue.updated_at,
    };
  }

  private get(path: string): Promise<Response> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.token) headers['private-token'] = this.token;
    return fetch(`${this.baseUrl}/api/v4${path}`, { headers });
  }
}

/** Singleton GitLab connector — registered automatically via connectors/index.ts */
export const gitlabConnector = new GitLabConnector();
