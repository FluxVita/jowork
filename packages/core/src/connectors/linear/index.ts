import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { config } from '../../config.js';
import { httpRequest } from '../../utils/http.js';
import { cacheGet, cacheSet } from '../base.js';
import { upsertObject, getObjectByUri } from '../../datamap/objects.js';
import { saveContent, readContentByPath } from '../../datamap/content-store.js';
import { getCursor, setCursor } from '../sync-state.js';
import { createLogger } from '../../utils/logger.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('linear-connector');

const LINEAR_API = 'https://api.linear.app/graphql';
const LINEAR_AUTH_URL = 'https://linear.app/oauth/authorize';
const LINEAR_TOKEN_URL = 'https://api.linear.app/oauth/token';

const TTL = {
  issue: 900,       // 15min
  project: 14400,   // 4h
  cycle: 3600,      // 1h
  document: 900,
} as const;

// ─── 认证：OAuth token 优先，API key 兜底 ───

function getLinearToken(): string {
  // 1. OAuth token（推荐）
  const creds = getOAuthCredentials('linear_v1');
  if (creds?.access_token) return creds.access_token;
  // 2. 环境变量 API key（向后兼容）
  if (config.linear.api_key) return config.linear.api_key;
  throw new Error('Linear not connected. Please authorize via OAuth or set LINEAR_API_KEY.');
}

// ─── GraphQL 辅助 ───

async function linearQuery<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const token = getLinearToken();

  const resp = await httpRequest<{ data: T; errors?: { message: string }[] }>(LINEAR_API, {
    method: 'POST',
    headers: {
      Authorization: token,
    },
    body: { query, variables },
    timeout: 20_000,
  });

  if (resp.data.errors?.length) {
    throw new Error(`Linear API error: ${resp.data.errors[0].message}`);
  }

  return resp.data.data;
}

// ─── Linear Connector ───

export class LinearConnector implements Connector {
  readonly id = 'linear_v1';
  readonly source: DataSource = 'linear';

  // ─── OAuth 支持 ───

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.linear;
    if (!client_id) throw new Error('LINEAR_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'read write',
      state,
    });
    return `${LINEAR_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.linear;
    if (!client_id || !client_secret) throw new Error('LINEAR_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      access_token: string;
      token_type: string;
      scope: string;
      expires_in?: number;
    }>(LINEAR_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        redirect_uri: redirectUri,
        client_id,
        client_secret,
        grant_type: 'authorization_code',
      }).toString(),
    });

    saveOAuthCredentials('linear_v1', {
      access_token: resp.data.access_token,
      scope: resp.data.scope,
      expires_at: resp.data.expires_in ? Date.now() + resp.data.expires_in * 1000 : undefined,
    });
    log.info('Linear OAuth token saved');
  }

  /** 发现数据对象（支持增量） */
  async discover(): Promise<DataObject[]> {
    try { getLinearToken(); } catch {
      log.warn('Linear not connected, skipping discovery');
      return [];
    }

    const cursor = getCursor(this.id, 'last_indexed_at');
    const updatedAfter = cursor ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const isIncremental = !!cursor;

    const objects: DataObject[] = [];

    try {
      const projects = await this.discoverProjects();
      objects.push(...projects);

      const issues = await this.discoverIssues(updatedAfter);
      objects.push(...issues);
    } catch (err) {
      log.error('Linear discovery failed', err);
    }

    for (const obj of objects) {
      upsertObject(obj);
    }

    setCursor(this.id, 'last_indexed_at', new Date().toISOString());
    log.info(`Linear discover complete: ${objects.length} objects indexed (${isIncremental ? 'incremental' : 'full'})`);
    return objects;
  }

  /** 按需拉取内容（本地文件优先） */
  async fetch(
    uri: string,
    _userContext: { user_id: string; role: Role },
  ): Promise<{ content: string; content_type: string; cached: boolean }> {
    // 优先查本地全文文件
    const obj = getObjectByUri(uri);
    if (obj?.content_path) {
      const localContent = readContentByPath(obj.content_path);
      if (localContent) {
        return { content: localContent, content_type: 'text/markdown', cached: true };
      }
    }

    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    const parsed = this.parseUri(uri);
    if (!parsed) throw new Error(`Invalid Linear URI: ${uri}`);

    let content: string;

    switch (parsed.type) {
      case 'issue':
        content = await this.fetchIssueDetail(parsed.id);
        break;
      case 'project':
        content = await this.fetchProjectDetail(parsed.id);
        break;
      default:
        throw new Error(`Unsupported Linear resource: ${parsed.type}`);
    }

    const ttl = obj?.ttl_seconds ?? (TTL as Record<string, number>)[parsed.type] ?? 900;
    cacheSet(uri, content, 'text/markdown', ttl);

    return { content, content_type: 'text/markdown', cached: false };
  }

  /** 健康检查 */
  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await linearQuery<{ viewer: { id: string } }>('{ viewer { id } }');
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - start, error: String(err) };
    }
  }

  // ─── 内部方法 ───

  private async discoverProjects(): Promise<DataObject[]> {
    const data = await linearQuery<{
      projects: {
        nodes: {
          id: string; name: string; description: string;
          state: string; url: string;
          lead: { name: string } | null;
          createdAt: string; updatedAt: string;
        }[];
      };
    }>(`{
      projects(first: 50, orderBy: updatedAt) {
        nodes {
          id name description state url
          lead { name }
          createdAt updatedAt
        }
      }
    }`);

    const now = new Date().toISOString();
    return data.projects.nodes.map(p => ({
      object_id: `dm_linear_project_${p.id}`,
      source: 'linear' as DataSource,
      source_type: 'project' as const,
      uri: `linear://project/${p.id}`,
      external_url: p.url,
      title: p.name,
      summary: p.description?.slice(0, 200),
      sensitivity: 'internal' as const,
      acl: { read: ['role:all_staff'] },
      tags: ['project', p.state?.toLowerCase()].filter(Boolean) as string[],
      owner: p.lead?.name,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
      last_indexed_at: now,
      ttl_seconds: TTL.project,
      connector_id: this.id,
      data_scope: 'public',
      metadata: { linear_id: p.id, state: p.state },
    }));
  }

  private async discoverIssues(updatedAfter: string): Promise<DataObject[]> {

    const data = await linearQuery<{
      issues: {
        nodes: {
          id: string; identifier: string; title: string; description: string;
          state: { name: string }; priority: number; url: string;
          assignee: { name: string } | null;
          team: { name: string };
          labels: { nodes: { name: string }[] };
          createdAt: string; updatedAt: string;
        }[];
      };
    }>(`query($after: DateTime!) {
      issues(first: 100, orderBy: updatedAt, filter: { updatedAt: { gte: $after } }) {
        nodes {
          id identifier title description
          state { name } priority url
          assignee { name }
          team { name }
          labels { nodes { name } }
          createdAt updatedAt
        }
      }
    }`, { after: updatedAfter });

    const now = new Date().toISOString();
    const objects: DataObject[] = [];

    for (const i of data.issues.nodes) {
      const objectId = `dm_linear_issue_${i.id}`;
      const obj: DataObject = {
        object_id: objectId,
        source: 'linear' as DataSource,
        source_type: 'issue' as const,
        uri: `linear://issue/${i.id}`,
        external_url: i.url,
        title: `${i.identifier}: ${i.title}`,
        summary: i.description?.slice(0, 200),
        sensitivity: 'internal' as const,
        acl: { read: ['role:all_staff'] },
        tags: [
          'issue', i.state?.name?.toLowerCase(),
          i.team?.name?.toLowerCase(),
          ...i.labels.nodes.map(l => l.name),
        ].filter(Boolean) as string[],
        owner: i.assignee?.name,
        created_at: i.createdAt,
        updated_at: i.updatedAt,
        last_indexed_at: now,
        ttl_seconds: TTL.issue,
        connector_id: this.id,
        data_scope: 'public',
        metadata: { linear_id: i.id, identifier: i.identifier, priority: i.priority, state: i.state?.name },
      };

      // 存 Issue 描述全文
      if (i.description) {
        try {
          const contentPath = saveContent('linear', objectId, i.description);
          obj.content_path = contentPath;
          obj.content_length = i.description.length;
        } catch { /* non-critical */ }
      }

      objects.push(obj);
    }

    return objects;
  }

  private async fetchIssueDetail(id: string): Promise<string> {
    const data = await linearQuery<{
      issue: {
        identifier: string; title: string; description: string;
        state: { name: string }; priority: number; url: string;
        assignee: { name: string } | null;
        team: { name: string };
        labels: { nodes: { name: string }[] };
        comments: { nodes: { body: string; user: { name: string }; createdAt: string }[] };
        createdAt: string; updatedAt: string;
      };
    }>(`query($id: String!) {
      issue(id: $id) {
        identifier title description
        state { name } priority url
        assignee { name }
        team { name }
        labels { nodes { name } }
        comments(first: 20) { nodes { body user { name } createdAt } }
        createdAt updatedAt
      }
    }`, { id });

    const i = data.issue;
    let md = `# ${i.identifier}: ${i.title}\n\n`;
    md += `**Team**: ${i.team.name}\n`;
    md += `**State**: ${i.state.name}\n`;
    md += `**Priority**: ${i.priority}\n`;
    md += `**Assignee**: ${i.assignee?.name || '(unassigned)'}\n`;
    md += `**Labels**: ${i.labels.nodes.map(l => l.name).join(', ') || '(none)'}\n`;
    md += `**Created**: ${i.createdAt}\n\n`;
    md += `## Description\n\n${i.description || '(none)'}\n\n`;

    if (i.comments.nodes.length) {
      md += `## Comments (${i.comments.nodes.length})\n\n`;
      for (const c of i.comments.nodes) {
        md += `**${c.user.name}** (${c.createdAt}):\n${c.body}\n\n---\n\n`;
      }
    }

    return md;
  }

  private async fetchProjectDetail(id: string): Promise<string> {
    const data = await linearQuery<{
      project: {
        name: string; description: string; state: string; url: string;
        lead: { name: string } | null;
        members: { nodes: { name: string }[] };
        issues: { nodes: { identifier: string; title: string; state: { name: string } }[] };
        createdAt: string; updatedAt: string;
      };
    }>(`query($id: String!) {
      project(id: $id) {
        name description state url
        lead { name }
        members { nodes { name } }
        issues(first: 30) { nodes { identifier title state { name } } }
        createdAt updatedAt
      }
    }`, { id });

    const p = data.project;
    let md = `# Project: ${p.name}\n\n`;
    md += `**State**: ${p.state}\n`;
    md += `**Lead**: ${p.lead?.name || '(none)'}\n`;
    md += `**Members**: ${p.members.nodes.map(m => m.name).join(', ')}\n\n`;
    md += `## Description\n\n${p.description || '(none)'}\n\n`;

    if (p.issues.nodes.length) {
      md += `## Issues (${p.issues.nodes.length})\n\n`;
      for (const i of p.issues.nodes) {
        md += `- [${i.state.name}] ${i.identifier}: ${i.title}\n`;
      }
    }

    return md;
  }

  private parseUri(uri: string): { type: string; id: string } | null {
    const match = uri.match(/^linear:\/\/(issue|project|cycle|document)\/(.+)$/);
    if (!match) return null;
    return { type: match[1], id: match[2] };
  }
}
