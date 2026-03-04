// @jowork/core/connectors/jira — Jira connector (JCP implementation)
//
// Connects to Jira Cloud or Jira Server/Data Center workspaces.
// Discovers issues, fetches full issue detail, and supports JQL search.
// Auth: API Token + email (Jira Cloud) or PAT (Jira Server).
//
// Config:
//   baseUrl   — Jira instance URL, e.g. "https://mycompany.atlassian.net"
//   projectKey — Optional: limit discover to a single project (e.g. "ENG")

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

// ─── Jira API types ───────────────────────────────────────────────────────────

interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description?: string | null;
    status: { name: string };
    priority?: { name: string } | null;
    assignee?: { displayName: string } | null;
    project: { key: string; name: string };
    updated: string;
    issuetype: { name: string };
  };
  self: string;
}

interface JiraSearchResult {
  issues: JiraIssue[];
  total: number;
  startAt: number;
  maxResults: number;
}

// ─── Connector implementation ─────────────────────────────────────────────────

class JiraConnector implements JoworkConnector {
  readonly defaultSensitivity = 'internal' as const;

  readonly manifest: ConnectorManifest = {
    id: 'jira',
    name: 'Jira',
    version: '0.1.0',
    description: 'Connect to Jira issues via REST API (Cloud or Server)',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      required: ['baseUrl'],
      properties: {
        baseUrl: {
          type: 'string',
          title: 'Jira URL',
          description: 'Your Jira instance URL (e.g. https://mycompany.atlassian.net)',
        },
        projectKey: {
          type: 'string',
          title: 'Project Key',
          description: 'Limit to a single project (e.g. "ENG"). Leave empty for all projects.',
        },
        email: {
          type: 'string',
          title: 'Email',
          description: 'Your Atlassian account email (required for Jira Cloud API token auth)',
        },
      },
    },
  };

  private baseUrl    = '';
  private email      = '';
  private apiToken   = '';
  private projectKey = '';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.baseUrl    = ((config['baseUrl'] as string) ?? '').replace(/\/$/, '');
    this.projectKey = (config['projectKey'] as string) ?? '';
    this.email      = (config['email'] as string) ?? '';
    this.apiToken   = credentials.apiKey ?? credentials.accessToken ?? '';
  }

  async shutdown(): Promise<void> {
    this.apiToken = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res = await this.get('/rest/api/3/myself');
      if (!res.ok) {
        return { ok: false, latencyMs: Date.now() - start, error: `HTTP ${res.status}` };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    const startAt = cursor ? parseInt(cursor, 10) : 0;
    const maxResults = 50;

    const jql = this.projectKey
      ? `project = "${this.projectKey}" ORDER BY updated DESC`
      : 'ORDER BY updated DESC';

    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields: 'summary,status,priority,assignee,project,updated,issuetype',
    });

    const res = await this.get(`/rest/api/3/search?${params.toString()}`);
    if (!res.ok) throw new Error(`Jira discover error: HTTP ${res.status}`);

    const data = await res.json() as JiraSearchResult;

    const objects: DataObject[] = data.issues.map(issue => ({
      uri:      `jira:issue:${issue.key}`,
      name:     `[${issue.fields.project.key}] ${issue.fields.summary}`,
      kind:     'issue',
      url:      `${this.baseUrl}/browse/${issue.key}`,
      updatedAt: issue.fields.updated,
      metadata: {
        status:    issue.fields.status.name,
        priority:  issue.fields.priority?.name ?? null,
        project:   issue.fields.project.name,
        assignee:  issue.fields.assignee?.displayName ?? null,
        issueType: issue.fields.issuetype.name,
      },
    }));

    const nextStart = startAt + data.issues.length;
    const hasMore   = nextStart < data.total;

    return {
      objects,
      ...(hasMore ? { nextCursor: String(nextStart) } : {}),
    };
  }

  async fetch(uri: string): Promise<FetchedContent> {
    const [, type, key] = uri.split(':');
    if (type !== 'issue') throw new Error(`Unknown Jira URI type: ${type}`);

    const res = await this.get(`/rest/api/3/issue/${key}?fields=summary,description,status,priority,assignee,project,updated,issuetype,comment`);
    if (!res.ok) throw new Error(`Jira fetch error: HTTP ${res.status}`);

    const issue = await res.json() as JiraIssue & {
      fields: JiraIssue['fields'] & {
        comment?: { comments: Array<{ author: { displayName: string }; body: string; created: string }> };
      };
    };

    const lines: string[] = [
      `**Issue**: ${issue.key}`,
      `**Summary**: ${issue.fields.summary}`,
      `**Type**: ${issue.fields.issuetype.name}`,
      `**Status**: ${issue.fields.status.name}`,
      issue.fields.priority ? `**Priority**: ${issue.fields.priority.name}` : null,
      issue.fields.assignee ? `**Assignee**: ${issue.fields.assignee.displayName}` : null,
      `**Project**: ${issue.fields.project.name} (${issue.fields.project.key})`,
      '',
      '## Description',
      issue.fields.description
        ? (typeof issue.fields.description === 'string'
            ? issue.fields.description
            : JSON.stringify(issue.fields.description))  // Jira ADF → fallback
        : '(no description)',
    ].filter((l): l is string => l !== null);

    return {
      uri:         `jira:issue:${issue.key}`,
      title:       `[${issue.fields.project.key}] ${issue.fields.summary}`,
      content:     lines.join('\n'),
      contentType: 'text/markdown',
      url:         `${this.baseUrl}/browse/${issue.key}`,
      updatedAt:   issue.fields.updated,
    };
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    const jql = this.projectKey
      ? `project = "${this.projectKey}" AND text ~ "${query.replace(/"/g, '\\"')}" ORDER BY updated DESC`
      : `text ~ "${query.replace(/"/g, '\\"')}" ORDER BY updated DESC`;

    const params = new URLSearchParams({
      jql,
      maxResults: String(Math.min(limit, 50)),
      fields: 'summary,description,status,project,updated',
    });

    const res = await this.get(`/rest/api/3/search?${params.toString()}`);
    if (!res.ok) throw new Error(`Jira search error: HTTP ${res.status}`);

    const data = await res.json() as JiraSearchResult;
    return data.issues.map(issue => ({
      uri:         `jira:issue:${issue.key}`,
      title:       `[${issue.fields.project.key}] ${issue.fields.summary}`,
      content:     typeof issue.fields.description === 'string'
                     ? issue.fields.description
                     : '(no description)',
      contentType: 'text/plain',
      url:         `${this.baseUrl}/browse/${issue.key}`,
      updatedAt:   issue.fields.updated,
    }));
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private get(path: string): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'accept': 'application/json',
      'content-type': 'application/json',
    };

    // Jira Cloud: Basic auth with email:apiToken
    // Jira Server with PAT: Bearer token
    if (this.email) {
      const creds = Buffer.from(`${this.email}:${this.apiToken}`).toString('base64');
      headers['authorization'] = `Basic ${creds}`;
    } else {
      headers['authorization'] = `Bearer ${this.apiToken}`;
    }

    return fetch(url, { headers });
  }
}

/** Singleton Jira connector — registered automatically via connectors/index.ts */
export const jiraConnector = new JiraConnector();
