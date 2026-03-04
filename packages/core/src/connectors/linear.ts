// @jowork/core/connectors/linear — Linear connector (JCP implementation)
//
// Connects to Linear workspaces: issues, projects, cycles.
// Uses Linear GraphQL API.
// Auth: API Key (Personal API key from Linear → Settings → API).

import type {
  JoworkConnector,
  ConnectorManifest,
  ConnectorCredentials,
  DiscoverPage,
  DataObject,
  FetchedContent,
  HealthResult,
} from './protocol.js';

interface LinearIssue {
  id: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string };
  priority: number;
  updatedAt: string;
  team: { key: string; name: string };
  assignee?: { name: string } | null;
}

interface LinearProject {
  id: string;
  name: string;
  description: string | null;
  url: string;
  updatedAt: string;
  state: string;
}

const GQL_ISSUES = `
query Issues($after: String) {
  issues(first: 50, after: $after, orderBy: updatedAt) {
    nodes {
      id title description url updatedAt priority
      state { name }
      team { key name }
      assignee { name }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const GQL_ISSUE = `
query Issue($id: String!) {
  issue(id: $id) {
    id title description url updatedAt priority
    state { name }
    team { key name }
    assignee { name }
  }
}`;

const GQL_SEARCH = `
query SearchIssues($query: String!) {
  issueSearch(query: $query, first: 20) {
    nodes {
      id title description url updatedAt
      state { name }
      team { key name }
    }
  }
}`;

const GQL_VIEWER = `query { viewer { id name email } }`;

class LinearConnector implements JoworkConnector {
  // Linear issues are internal workspace data
  readonly defaultSensitivity = 'internal' as const;

  readonly manifest: ConnectorManifest = {
    id: 'linear',
    name: 'Linear',
    version: '0.1.0',
    description: 'Connect to Linear issues, projects, and cycles',
    authType: 'api_token',
    capabilities: ['discover', 'fetch', 'search'],
    configSchema: {
      type: 'object',
      properties: {
        teamKey: {
          type: 'string',
          title: 'Team Key',
          description: 'Linear team identifier (e.g. "ENG"). Leave empty for all teams.',
        },
      },
    },
  };

  private token   = '';
  private teamKey = '';
  private apiUrl  = 'https://api.linear.app/graphql';

  async initialize(config: Record<string, unknown>, credentials: ConnectorCredentials): Promise<void> {
    this.token   = credentials.apiKey ?? credentials.accessToken ?? '';
    this.teamKey = (config['teamKey'] as string) ?? '';
  }

  async shutdown(): Promise<void> {
    this.token = '';
  }

  async health(): Promise<HealthResult> {
    const start = Date.now();
    try {
      const res  = await this.gql(GQL_VIEWER, {});
      const data = await res.json() as { data?: { viewer?: { id: string } }; errors?: unknown[] };
      if (data.errors?.length || !data.data?.viewer) {
        return { ok: false, latencyMs: Date.now() - start, error: JSON.stringify(data.errors) };
      }
      return { ok: true, latencyMs: Date.now() - start };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - start, error: String(err) };
    }
  }

  async discover(cursor?: string): Promise<DiscoverPage> {
    const variables: Record<string, unknown> = {};
    if (cursor) variables['after'] = cursor;

    const res  = await this.gql(GQL_ISSUES, variables);
    const data = await res.json() as {
      data?: {
        issues: {
          nodes: LinearIssue[];
          pageInfo: { hasNextPage: boolean; endCursor: string };
        };
      };
      errors?: unknown[];
    };

    if (data.errors?.length) throw new Error(`Linear discover error: ${JSON.stringify(data.errors)}`);

    const issues = data.data?.issues.nodes ?? [];
    const objects: DataObject[] = issues
      .filter(i => !this.teamKey || i.team.key === this.teamKey)
      .map(i => ({
        uri:      `linear:issue:${i.id}`,
        name:     `[${i.team.key}] ${i.title}`,
        kind:     'issue',
        url:      i.url,
        updatedAt: i.updatedAt,
        metadata: {
          state:    i.state.name,
          priority: i.priority,
          team:     i.team.name,
          assignee: i.assignee?.name ?? null,
        },
      }));

    const pageInfo = data.data?.issues.pageInfo;
    return {
      objects,
      ...(pageInfo?.hasNextPage ? { nextCursor: pageInfo.endCursor } : {}),
    };
  }

  async fetch(uri: string): Promise<FetchedContent> {
    const [, type, id] = uri.split(':');
    if (type !== 'issue') throw new Error(`Unknown Linear URI type: ${type}`);

    const res  = await this.gql(GQL_ISSUE, { id });
    const data = await res.json() as { data?: { issue: LinearIssue }; errors?: unknown[] };

    if (data.errors?.length) throw new Error(`Linear fetch error: ${JSON.stringify(data.errors)}`);

    const issue = data.data?.issue;
    if (!issue) throw new Error(`Linear issue not found: ${id}`);

    const content = [
      `**State**: ${issue.state.name}`,
      `**Team**: ${issue.team.name} (${issue.team.key})`,
      `**Priority**: ${issue.priority}`,
      issue.assignee ? `**Assignee**: ${issue.assignee.name}` : null,
      '',
      issue.description ?? '(no description)',
    ].filter(l => l !== null).join('\n');

    return {
      uri:         `linear:issue:${issue.id}`,
      title:       `[${issue.team.key}] ${issue.title}`,
      content,
      contentType: 'text/markdown',
      url:         issue.url,
      updatedAt:   issue.updatedAt,
    };
  }

  async search(query: string, limit = 10): Promise<FetchedContent[]> {
    const res  = await this.gql(GQL_SEARCH, { query });
    const data = await res.json() as {
      data?: { issueSearch: { nodes: LinearIssue[] } };
      errors?: unknown[];
    };

    if (data.errors?.length) throw new Error(`Linear search error: ${JSON.stringify(data.errors)}`);

    const issues = (data.data?.issueSearch.nodes ?? []).slice(0, limit);
    return issues.map(i => ({
      uri:         `linear:issue:${i.id}`,
      title:       `[${i.team.key}] ${i.title}`,
      content:     i.description ?? '(no description)',
      contentType: 'text/plain',
      url:         i.url,
      updatedAt:   i.updatedAt,
    }));
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private gql(query: string, variables: Record<string, unknown>): Promise<Response> {
    return fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'authorization': this.token,
        'content-type':  'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });
  }
}

/** Singleton Linear connector — registered automatically via connectors/index.ts */
export const linearConnector = new LinearConnector();
