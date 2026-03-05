import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { config } from '../../config.js';
import { httpRequest } from '../../utils/http.js';
import { cacheGet, cacheSet } from '../base.js';
import { upsertObject, getObjectByUri } from '../../datamap/objects.js';
import { saveContent, readContentByPath } from '../../datamap/content-store.js';
import { trackApiCall } from '../../quota/manager.js';
import { getCursor, setCursor } from '../sync-state.js';
import { mirrorProject, readFileFromMirror } from './repo-mirror.js';
import { createLogger } from '../../utils/logger.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';
import type { ConnectorManifest } from '../protocol.js';

const log = createLogger('gitlab-connector');

// ─── GitLab API 类型 ───

interface GitLabProject {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  description: string | null;
  web_url: string;
  default_branch: string;
  created_at: string;
  last_activity_at: string;
  visibility: string;
  owner?: { username: string };
}

interface GitLabMR {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  web_url: string;
  source_branch: string;
  target_branch: string;
  author: { username: string };
  created_at: string;
  updated_at: string;
  project_id: number;
}

interface GitLabIssue {
  id: number;
  iid: number;
  title: string;
  description: string | null;
  state: string;
  web_url: string;
  author: { username: string };
  assignees: { username: string }[];
  labels: string[];
  created_at: string;
  updated_at: string;
  project_id: number;
}

// ─── TTL 策略 ───
const TTL = {
  repository: 14400,      // 4h — 稳定
  merge_request: 900,     // 15min — 频变
  issue: 900,
  pipeline: 300,          // 5min
} as const;

// ─── GitLab Connector ───

export class GitLabConnector implements Connector {
  readonly manifest: ConnectorManifest = {
    id: 'gitlab',
    name: 'GitLab',
    version: '1.0.0',
    description: 'Index GitLab repositories, merge requests and issues',
    auth: {
      type: 'oauth2',
      authorize_url: '/oauth/authorize',
      token_url: '/oauth/token',
      scopes: ['read_api', 'read_repository'],
      docs_url: 'https://docs.gitlab.com/integration/oauth_provider/',
    },
    capabilities: ['discover', 'fetch'],
    data_types: ['repository', 'merge_request', 'issue'],
  };

  readonly id = 'gitlab_v1';
  readonly source: DataSource = 'gitlab';

  private get baseUrl(): string {
    return config.gitlab.url.replace(/\/$/, '');
  }

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.gitlab;
    if (!client_id) throw new Error('GITLAB_OAUTH_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'read_api read_repository',
      state,
    });
    return `${this.baseUrl}/oauth/authorize?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.gitlab;
    if (!client_id || !client_secret) throw new Error('GITLAB_OAUTH_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{
      access_token: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      scope?: string;
      created_at?: number;
    }>(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id,
        client_secret,
      }).toString(),
    });

    if (!resp.data.access_token) throw new Error('GitLab OAuth failed: missing access_token');

    const expiresAt = resp.data.expires_in
      ? Date.now() + resp.data.expires_in * 1000
      : undefined;

    saveOAuthCredentials('gitlab_v1', {
      access_token: resp.data.access_token,
      refresh_token: resp.data.refresh_token,
      expires_at: expiresAt,
      scope: resp.data.scope,
      extra: {
        token_type: resp.data.token_type,
        created_at: resp.data.created_at,
      },
    });
    log.info('GitLab OAuth token saved');
  }

  private get token(): string {
    const oauth = getOAuthCredentials('gitlab_v1');
    if (oauth?.access_token) return oauth.access_token;
    return config.gitlab.token;
  }

  /** GitLab API 请求 */
  private async api<T>(path: string, params?: Record<string, string>): Promise<T> {
    let url = `${this.baseUrl}/api/v4${path}`;
    if (params) {
      url += '?' + new URLSearchParams(params).toString();
    }

    const resp = await httpRequest<T>(url, {
      headers: {
        Authorization: `Bearer ${this.token}`,
        'PRIVATE-TOKEN': this.token,
      },
    });

    if (!resp.ok) {
      const err = new Error(`GitLab API error: ${resp.status}`) as Error & { statusCode: number };
      err.statusCode = resp.status;
      throw err;
    }

    return resp.data;
  }

  /** 发现数据对象：列举项目、MR、Issue（支持增量） */
  async discover(): Promise<DataObject[]> {
    if (!this.token) {
      log.warn('GitLab token not configured, skipping discovery (authorize via OAuth or set GITLAB_TOKEN)');
      return [];
    }

    // cursor：上次索引时间，无则取 30 天前（首次全量）
    const cursor = getCursor(this.id, 'last_indexed_at');
    const updatedAfter = cursor ?? new Date(Date.now() - 30 * 86400_000).toISOString();
    const isIncremental = !!cursor;

    const objects: DataObject[] = [];

    try {
      const projects = await this.discoverProjects();
      objects.push(...projects);

      for (const proj of projects) {
        const projectId = (proj.metadata as { gitlab_id: number })?.gitlab_id;
        if (!projectId) continue;

        try {
          const mrs = await this.discoverMRs(projectId, proj.title, updatedAfter);
          objects.push(...mrs);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 403 || status === 404) {
            log.warn(`MR discovery skipped for project ${proj.title} (HTTP ${status})`);
          } else {
            log.error(`MR discovery failed for project ${proj.title}`, err);
          }
        }

        try {
          const issues = await this.discoverIssues(projectId, proj.title, updatedAfter);
          objects.push(...issues);
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 403 || status === 404) {
            log.warn(`Issue discovery skipped for project ${proj.title} (HTTP ${status})`);
          } else {
            log.error(`Issue discovery failed for project ${proj.title}`, err);
          }
        }
      }
    } catch (err) {
      log.error('GitLab discovery failed', err);
    }

    for (const obj of objects) {
      upsertObject(obj);
    }

    setCursor(this.id, 'last_indexed_at', new Date().toISOString());
    log.info(`GitLab discover complete: ${objects.length} objects indexed (${isIncremental ? 'incremental' : 'full'})`);

    // 异步触发代码镜像（不阻塞主流程）
    for (const proj of objects.filter(o => o.source_type === 'repository')) {
      const meta = proj.metadata as { gitlab_id?: number; path?: string };
      if (meta?.gitlab_id && meta?.path) {
        const cloneUrl = `${this.baseUrl}/${meta.path}.git`;
        mirrorProject(meta.gitlab_id, cloneUrl).catch(err => {
          log.warn(`Mirror async trigger failed for project ${meta.gitlab_id}`, String(err));
        });
      }
    }

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

    // 再查加密缓存
    const cached = cacheGet(uri);
    if (cached) {
      return { content: cached.content, content_type: cached.content_type, cached: true };
    }

    const parsed = this.parseUri(uri);
    if (!parsed) throw new Error(`Invalid GitLab URI: ${uri}`);

    let content: string;
    const contentType = 'text/markdown';

    switch (parsed.type) {
      case 'repo': {
        content = await this.fetchRepoReadme(parsed.projectId);
        break;
      }
      case 'mr': {
        content = await this.fetchMRDetail(parsed.projectId, parsed.iid!);
        break;
      }
      case 'issue': {
        content = await this.fetchIssueDetail(parsed.projectId, parsed.iid!);
        break;
      }
      case 'file': {
        // 优先从本地镜像读取
        const mirrorContent = readFileFromMirror(parsed.projectId, parsed.filePath!, parsed.ref ?? 'HEAD');
        if (mirrorContent !== null) {
          content = mirrorContent;
          break;
        }
        content = await this.fetchFileContent(parsed.projectId, parsed.filePath!, parsed.ref);
        break;
      }
      default:
        throw new Error(`Unsupported GitLab resource type: ${parsed.type}`);
    }

    trackApiCall('gitlab' as DataSource, 'content_fetch');

    // 存到本地文件（供后续直接读取）
    if (content && obj) {
      try {
        const contentPath = saveContent('gitlab', obj.object_id, content);
        upsertObject({ ...obj, content_path: contentPath, content_length: content.length });
      } catch { /* non-critical */ }
    }

    // 缓存
    const ttl = obj ? obj.ttl_seconds : (TTL as Record<string, number>)[parsed.type] ?? 900;
    cacheSet(uri, content, contentType, ttl);

    return { content, content_type: contentType, cached: false };
  }

  /** 健康检查 */
  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    const start = Date.now();
    try {
      await this.api('/user');
      return { ok: true, latency_ms: Date.now() - start };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - start, error: String(err) };
    }
  }

  // ─── 内部方法 ───

  /** 发现项目 */
  private async discoverProjects(): Promise<DataObject[]> {
    const projects = await this.api<GitLabProject[]>('/projects', {
      membership: 'true',
      per_page: '100',
      order_by: 'last_activity_at',
      sort: 'desc',
    });

    const now = new Date().toISOString();
    return projects.map(p => ({
      object_id: `dm_gitlab_repo_${p.id}`,
      source: 'gitlab' as DataSource,
      source_type: 'repository' as const,
      uri: `gitlab://repo/${p.id}`,
      external_url: p.web_url,
      title: p.name_with_namespace,
      summary: p.description?.slice(0, 200) ?? undefined,
      sensitivity: p.visibility === 'public' ? 'public' as const : 'internal' as const,
      acl: { read: ['role:member', 'role:admin', 'role:owner'] },
      tags: ['code', 'repository'],
      owner: p.owner?.username,
      created_at: p.created_at,
      updated_at: p.last_activity_at,
      last_indexed_at: now,
      ttl_seconds: TTL.repository,
      connector_id: this.id,
      data_scope: 'dev',
      metadata: {
        gitlab_id: p.id,
        path: p.path_with_namespace,
        default_branch: p.default_branch,
        visibility: p.visibility,
      },
    }));
  }

  /** 发现 MR（基于 cursor 增量）+ 拉全文存本地 */
  private async discoverMRs(projectId: number, projectName: string, updatedAfter: string): Promise<DataObject[]> {
    const mrs = await this.api<GitLabMR[]>(`/projects/${projectId}/merge_requests`, {
      state: 'all',
      per_page: '50',
      order_by: 'updated_at',
      sort: 'desc',
      updated_after: updatedAfter,
    });

    const now = new Date().toISOString();
    const objects: DataObject[] = [];

    for (const mr of mrs) {
      const objectId = `dm_gitlab_mr_${projectId}_${mr.iid}`;
      const obj: DataObject = {
        object_id: objectId,
        source: 'gitlab' as DataSource,
        source_type: 'merge_request' as const,
        uri: `gitlab://mr/${projectId}/${mr.iid}`,
        external_url: mr.web_url,
        title: `[${projectName}] MR !${mr.iid}: ${mr.title}`,
        summary: mr.description?.slice(0, 200) ?? undefined,
        sensitivity: 'internal' as const,
        acl: { read: ['role:member', 'role:admin', 'role:owner'] },
        tags: ['code', 'merge_request', mr.state],
        owner: mr.author.username,
        created_at: mr.created_at,
        updated_at: mr.updated_at,
        last_indexed_at: now,
        ttl_seconds: TTL.merge_request,
        connector_id: this.id,
        data_scope: 'dev',
        metadata: {
          gitlab_project_id: projectId,
          iid: mr.iid,
          state: mr.state,
          source_branch: mr.source_branch,
          target_branch: mr.target_branch,
        },
      };

      // 存 MR 描述全文
      if (mr.description) {
        try {
          const contentPath = saveContent('gitlab', objectId, mr.description);
          obj.content_path = contentPath;
          obj.content_length = mr.description.length;
        } catch { /* non-critical */ }
      }

      objects.push(obj);
    }

    return objects;
  }

  /** 发现 Issue（基于 cursor 增量）+ 拉全文存本地 */
  private async discoverIssues(projectId: number, projectName: string, updatedAfter: string): Promise<DataObject[]> {
    const issues = await this.api<GitLabIssue[]>(`/projects/${projectId}/issues`, {
      state: 'all',
      per_page: '50',
      order_by: 'updated_at',
      sort: 'desc',
      updated_after: updatedAfter,
    });

    const now = new Date().toISOString();
    const objects: DataObject[] = [];

    for (const issue of issues) {
      const objectId = `dm_gitlab_issue_${projectId}_${issue.iid}`;
      const obj: DataObject = {
        object_id: objectId,
        source: 'gitlab' as DataSource,
        source_type: 'issue' as const,
        uri: `gitlab://issue/${projectId}/${issue.iid}`,
        external_url: issue.web_url,
        title: `[${projectName}] #${issue.iid}: ${issue.title}`,
        summary: issue.description?.slice(0, 200) ?? undefined,
        sensitivity: 'internal' as const,
        acl: { read: ['role:member', 'role:admin', 'role:owner'] },
        tags: ['issue', issue.state, ...issue.labels],
        owner: issue.author.username,
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        last_indexed_at: now,
        ttl_seconds: TTL.issue,
        connector_id: this.id,
        data_scope: 'dev',
        metadata: {
          gitlab_project_id: projectId,
          iid: issue.iid,
          state: issue.state,
          assignees: issue.assignees.map(a => a.username),
        },
      };

      // 存 Issue 描述全文
      if (issue.description) {
        try {
          const contentPath = saveContent('gitlab', objectId, issue.description);
          obj.content_path = contentPath;
          obj.content_length = issue.description.length;
        } catch { /* non-critical */ }
      }

      objects.push(obj);
    }

    return objects;
  }

  /** 获取仓库 README */
  private async fetchRepoReadme(projectId: number): Promise<string> {
    try {
      const file = await this.api<{ content: string; encoding: string }>(
        `/projects/${projectId}/repository/files/README.md`,
        { ref: 'main' },
      );
      return Buffer.from(file.content, file.encoding as BufferEncoding).toString('utf-8');
    } catch {
      // 尝试 master 分支
      try {
        const file = await this.api<{ content: string; encoding: string }>(
          `/projects/${projectId}/repository/files/README.md`,
          { ref: 'master' },
        );
        return Buffer.from(file.content, file.encoding as BufferEncoding).toString('utf-8');
      } catch {
        return '(No README found)';
      }
    }
  }

  /** 获取 MR 详情 */
  private async fetchMRDetail(projectId: number, iid: number): Promise<string> {
    const mr = await this.api<GitLabMR>(`/projects/${projectId}/merge_requests/${iid}`);

    const changes = await this.api<{ changes: { old_path: string; new_path: string; diff: string }[] }>(
      `/projects/${projectId}/merge_requests/${iid}/changes`,
    );

    let md = `# MR !${iid}: ${mr.title}\n\n`;
    md += `**Author**: ${mr.author.username}\n`;
    md += `**State**: ${mr.state}\n`;
    md += `**Branch**: ${mr.source_branch} → ${mr.target_branch}\n`;
    md += `**Created**: ${mr.created_at}\n`;
    md += `**Updated**: ${mr.updated_at}\n\n`;
    md += `## Description\n\n${mr.description || '(none)'}\n\n`;
    md += `## Changes (${changes.changes.length} files)\n\n`;

    for (const change of changes.changes.slice(0, 20)) {
      md += `### ${change.new_path}\n\`\`\`diff\n${change.diff?.slice(0, 2000) ?? ''}\n\`\`\`\n\n`;
    }

    return md;
  }

  /** 获取 Issue 详情 */
  private async fetchIssueDetail(projectId: number, iid: number): Promise<string> {
    const issue = await this.api<GitLabIssue>(`/projects/${projectId}/issues/${iid}`);

    const notes = await this.api<{ body: string; author: { username: string }; created_at: string }[]>(
      `/projects/${projectId}/issues/${iid}/notes`,
      { per_page: '20', sort: 'asc' },
    );

    let md = `# Issue #${iid}: ${issue.title}\n\n`;
    md += `**Author**: ${issue.author.username}\n`;
    md += `**State**: ${issue.state}\n`;
    md += `**Labels**: ${issue.labels.join(', ') || '(none)'}\n`;
    md += `**Assignees**: ${issue.assignees.map(a => a.username).join(', ') || '(none)'}\n`;
    md += `**Created**: ${issue.created_at}\n\n`;
    md += `## Description\n\n${issue.description || '(none)'}\n\n`;

    if (notes.length > 0) {
      md += `## Comments (${notes.length})\n\n`;
      for (const note of notes) {
        md += `**${note.author.username}** (${note.created_at}):\n${note.body}\n\n---\n\n`;
      }
    }

    return md;
  }

  /** 获取文件内容 */
  private async fetchFileContent(projectId: number, filePath: string, ref = 'main'): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const file = await this.api<{ content: string; encoding: string }>(
      `/projects/${projectId}/repository/files/${encodedPath}`,
      { ref },
    );
    return Buffer.from(file.content, file.encoding as BufferEncoding).toString('utf-8');
  }

  /** 解析 GitLab URI */
  private parseUri(uri: string): {
    type: string;
    projectId: number;
    iid?: number;
    filePath?: string;
    ref?: string;
  } | null {
    // gitlab://repo/{projectId}
    let match = uri.match(/^gitlab:\/\/repo\/(\d+)$/);
    if (match) return { type: 'repo', projectId: parseInt(match[1]) };

    // gitlab://mr/{projectId}/{iid}
    match = uri.match(/^gitlab:\/\/mr\/(\d+)\/(\d+)$/);
    if (match) return { type: 'mr', projectId: parseInt(match[1]), iid: parseInt(match[2]) };

    // gitlab://issue/{projectId}/{iid}
    match = uri.match(/^gitlab:\/\/issue\/(\d+)\/(\d+)$/);
    if (match) return { type: 'issue', projectId: parseInt(match[1]), iid: parseInt(match[2]) };

    // gitlab://file/{projectId}/{ref}/{filePath}
    match = uri.match(/^gitlab:\/\/file\/(\d+)\/([^/]+)\/(.+)$/);
    if (match) return { type: 'file', projectId: parseInt(match[1]), ref: match[2], filePath: match[3] };

    return null;
  }
}
