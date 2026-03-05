/**
 * GitHub Connector
 *
 * 索引 GitHub 仓库的 Issues 和 Pull Requests。
 *
 * 认证方式：Personal Access Token（PAT）
 * 环境变量：
 *   GITHUB_TOKEN      — GitHub PAT（必填，classic token 或 fine-grained）
 *   GITHUB_REPOS      — 逗号分隔的仓库列表，格式 "owner/repo"（必填，至少一个）
 *   GITHUB_INCLUDE_PRS — 是否索引 PR（默认 true）
 */

import type { Connector, DataObject, DataSource, Role } from '../../types.js';
import { upsertObject } from '../../datamap/objects.js';
import { cacheGet, cacheSet } from '../base.js';
import { createLogger } from '../../utils/logger.js';
import { httpRequest } from '../../utils/http.js';
import type { JoworkConnector, ConnectorManifest, ConnectorConfig, EncryptedCredentials, DiscoverResult } from '../protocol.js';
import { config } from '../../config.js';
import { getOAuthCredentials, saveOAuthCredentials } from '../oauth-store.js';

const log = createLogger('github-connector');

// ─── 配置 ─────────────────────────────────────────────────────────────────────

const GITHUB_API = 'https://api.github.com';
const CACHE_TTL_S = 300; // 5 分钟
const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

function getRepos(): string[] {
  const raw = process.env['GITHUB_REPOS'] ?? '';
  return raw.split(',').map(r => r.trim()).filter(Boolean);
}

function includePRs(): boolean {
  return (process.env['GITHUB_INCLUDE_PRS'] ?? 'true') !== 'false';
}

// ─── HTTP 辅助 ────────────────────────────────────────────────────────────────

async function ghGet<T>(path: string, token: string): Promise<T> {
  const res = await httpRequest<T>(`${GITHUB_API}${path}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  return res.data;
}

// ─── Issue / PR 格式化 ────────────────────────────────────────────────────────

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  pull_request?: { url: string };
  labels: Array<{ name: string }>;
}

interface GitHubWorkflowRun {
  id: number;
  name: string;
  display_title: string;
  event: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  run_number: number;
  head_branch: string;
  head_sha: string;
  created_at: string;
  updated_at: string;
  actor?: { login?: string };
}

interface GitHubWorkflowRunsResponse {
  workflow_runs: GitHubWorkflowRun[];
}

function formatIssue(repo: string, issue: GitHubIssue): string {
  const type = issue.pull_request ? 'PR' : 'Issue';
  const labels = issue.labels.map(l => l.name).join(', ');
  return [
    `# ${type} #${issue.number}: ${issue.title}`,
    `**Repo:** ${repo}  **State:** ${issue.state}  **Author:** ${issue.user?.login ?? 'unknown'}`,
    labels ? `**Labels:** ${labels}` : '',
    `**URL:** ${issue.html_url}`,
    `**Created:** ${issue.created_at}  **Updated:** ${issue.updated_at}`,
    '',
    issue.body ?? '_(no description)_',
  ].filter(l => l !== undefined).join('\n');
}

function formatWorkflowRun(repo: string, run: GitHubWorkflowRun): string {
  return [
    `# Workflow Run #${run.run_number}: ${run.name || run.display_title || `run-${run.id}`}`,
    `**Repo:** ${repo}  **Status:** ${run.status}  **Conclusion:** ${run.conclusion ?? 'n/a'}`,
    `**Branch:** ${run.head_branch || 'n/a'}  **Commit:** ${run.head_sha || 'n/a'}`,
    `**Event:** ${run.event}  **Actor:** ${run.actor?.login ?? 'unknown'}`,
    `**URL:** ${run.html_url}`,
    `**Created:** ${run.created_at}  **Updated:** ${run.updated_at}`,
  ].join('\n');
}

// ─── GitHubConnector 实现 ─────────────────────────────────────────────────────

export class GitHubConnector implements Connector {
  readonly manifest: ConnectorManifest = {
    id: 'github',
    name: 'GitHub',
    version: '1.0.0',
    description: 'Index GitHub Issues, Pull Requests, and GitHub Actions runs from your repositories',
    auth: {
      type: 'oauth2',
      authorize_url: GITHUB_AUTH_URL,
      token_url: GITHUB_TOKEN_URL,
      scopes: ['repo', 'read:org'],
      docs_url: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens',
    },
    capabilities: ['discover', 'fetch'],
    data_types: ['issue', 'pull_request', 'pipeline'],
    config_schema: {
      type: 'object',
      properties: {
        repos: {
          type: 'string',
          title: 'Repositories',
          description: 'Comma-separated list of "owner/repo" to index',
        },
        include_prs: {
          type: 'boolean',
          title: 'Include Pull Requests',
          default: true,
        },
      },
      required: ['repos'],
    },
  };

  readonly id = 'github_v1';
  readonly source: DataSource = 'github';

  // ─── 认证：OAuth → env var 兜底 ───

  private getToken(): string {
    const creds = getOAuthCredentials('github_v1');
    if (creds?.access_token) return creds.access_token;
    if (process.env['GITHUB_TOKEN']) return process.env['GITHUB_TOKEN'];
    throw new Error('GitHub not connected. Please authorize via OAuth or set GITHUB_TOKEN.');
  }

  // ─── OAuth 支持 ───

  buildOAuthUrl(state: string, redirectUri: string): string {
    const { client_id } = config.github;
    if (!client_id) throw new Error('GITHUB_OAUTH_CLIENT_ID not configured');
    const params = new URLSearchParams({
      client_id,
      redirect_uri: redirectUri,
      scope: 'repo read:org',
      state,
    });
    return `${GITHUB_AUTH_URL}?${params}`;
  }

  async exchangeToken(code: string, redirectUri: string): Promise<void> {
    const { client_id, client_secret } = config.github;
    if (!client_id || !client_secret) throw new Error('GITHUB_OAUTH_CLIENT_ID/SECRET not configured');

    const resp = await httpRequest<{ access_token: string; scope: string; token_type: string }>(
      GITHUB_TOKEN_URL, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id, client_secret, code, redirect_uri: redirectUri }).toString(),
      });

    saveOAuthCredentials('github_v1', {
      access_token: resp.data.access_token,
      scope: resp.data.scope,
    });
    log.info('GitHub OAuth token saved');
  }

  async initialize(_config: ConnectorConfig, _credentials: EncryptedCredentials): Promise<void> {}
  async shutdown(): Promise<void> { /* stateless */ }

  async health(): Promise<{ ok: boolean; latency_ms: number; error?: string }> {
    let token: string;
    try { token = this.getToken(); } catch (err) { return { ok: false, latency_ms: -1, error: String(err) }; }
    const t0 = Date.now();
    try {
      await ghGet('/rate_limit', token);
      return { ok: true, latency_ms: Date.now() - t0 };
    } catch (err) {
      return { ok: false, latency_ms: Date.now() - t0, error: String(err) };
    }
  }

  async discover(): Promise<DataObject[]> {
    let token: string;
    try { token = this.getToken(); } catch {
      log.warn('GitHub not connected, skipping discovery');
      return [];
    }
    const repos = getRepos();
    if (repos.length === 0) {
      log.warn('GitHub connector: GITHUB_REPOS not configured');
      return [];
    }

    const objects: DataObject[] = [];
    const withPRs = includePRs();

    for (const repo of repos) {
      try {
        // 获取 issues（GitHub API 中 PR 也是 issue，通过 pull_request 字段区分）
        const issues = await ghGet<GitHubIssue[]>(
          `/repos/${repo}/issues?state=all&per_page=100&sort=updated&direction=desc`,
          token,
        );

        for (const issue of issues) {
          const isPR = Boolean(issue.pull_request);
          if (isPR && !withPRs) continue;

          const type: 'pull_request' | 'issue' = isPR ? 'pull_request' : 'issue';
          const uri = `github://${repo}/${type}/${issue.number}`;

          const partial = {
            uri,
            source: 'github' as const,
            source_type: type,
            title: `#${issue.number} ${issue.title}`,
            summary: issue.body?.slice(0, 200),
            sensitivity: 'internal' as const,
            tags: [repo.split('/')[0], repo, issue.state, ...issue.labels.map(l => l.name)],
            updated_at: issue.updated_at,
            ttl_seconds: CACHE_TTL_S,
            connector_id: this.id,
            acl: { read: ['role:all_staff'] },
          };

          await upsertObject(partial);
          objects.push(partial as DataObject);
        }

        log.info(`GitHub: indexed ${issues.length} issues/PRs from ${repo}`);

        const runs = await ghGet<GitHubWorkflowRunsResponse>(
          `/repos/${repo}/actions/runs?per_page=30`,
          token,
        );
        for (const run of runs.workflow_runs ?? []) {
          const uri = `github://${repo}/pipeline/${run.id}`;
          const partial = {
            uri,
            source: 'github' as const,
            source_type: 'pipeline' as const,
            title: `[${run.conclusion ?? run.status}] ${run.name || run.display_title || `run-${run.id}`}`,
            summary: `${run.event} · ${run.head_branch} · #${run.run_number}`,
            sensitivity: 'internal' as const,
            tags: [
              repo.split('/')[0],
              repo,
              'github_actions',
              `event:${run.event}`,
              `status:${run.status}`,
              `conclusion:${run.conclusion ?? 'n/a'}`,
            ],
            updated_at: run.updated_at,
            ttl_seconds: CACHE_TTL_S,
            connector_id: this.id,
            acl: { read: ['role:all_staff'] },
          };
          await upsertObject(partial);
          objects.push(partial as DataObject);
        }
        log.info(`GitHub: indexed ${(runs.workflow_runs ?? []).length} workflow runs from ${repo}`);
      } catch (err) {
        log.error(`GitHub: failed to fetch ${repo}`, err);
      }
    }

    return objects;
  }

  async fetch(uri: string, _userContext: { user_id: string; role: Role }): Promise<{
    content: string; content_type: string; cached: boolean;
  }> {
    const cached = cacheGet(uri);
    if (cached) return { ...cached, cached: true };

    // 解析 uri:
    // github://owner/repo/issue/123
    // github://owner/repo/pull_request/456
    // github://owner/repo/pipeline/789
    const match = uri.match(/^github:\/\/([^/]+\/[^/]+)\/(issue|pull_request|pipeline)\/(\d+)$/);
    if (!match) throw new Error(`Invalid GitHub URI: ${uri}`);

    const [, repo, type, numberStr] = match;
    const token = this.getToken();

    let content = '';
    if (type === 'pipeline') {
      const run = await ghGet<GitHubWorkflowRun>(`/repos/${repo}/actions/runs/${numberStr}`, token);
      content = formatWorkflowRun(repo, run);
    } else {
      const endpoint = type === 'pull_request'
        ? `/repos/${repo}/pulls/${numberStr}`
        : `/repos/${repo}/issues/${numberStr}`;
      const issue = await ghGet<GitHubIssue>(endpoint, token);
      content = formatIssue(repo, issue);
    }

    cacheSet(uri, content, 'text/markdown', CACHE_TTL_S);
    return { content, content_type: 'text/markdown', cached: false };
  }
}

/** 单例实例 */
export const githubConnector = new GitHubConnector();
