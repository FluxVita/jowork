import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from './feishu.js';
import { logInfo, logError } from '../utils/logger.js';

export interface GitHubSyncLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface GitHubSyncResult {
  repos: number;
  issues: number;
  prs: number;
  newObjects: number;
}

const defaultLogger: GitHubSyncLogger = {
  info: (msg, ctx) => logInfo('sync', msg, ctx),
  warn: (msg, ctx) => logError('sync', msg, ctx),
  error: (msg, ctx) => logError('sync', msg, ctx),
};

const GITHUB_API = 'https://api.github.com';
const MAX_REPOS = 30;
const RATE_LIMIT_DELAY_MS = 200;

interface GitHubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  open_issues_count: number;
  private: boolean;
}

interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  user: { login: string } | null;
  pull_request?: { html_url: string };
  created_at: string;
  updated_at: string;
  labels: Array<{ name: string }>;
}

/** Sync GitHub repos, issues, and PRs for the authenticated user. */
export async function syncGitHub(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: GitHubSyncLogger = defaultLogger,
): Promise<GitHubSyncResult> {
  const token = data.token;
  if (!token) throw new Error('Missing GitHub token');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'jowork/0.1.0',
  };

  let repos = 0;
  let issues = 0;
  let prs = 0;
  let newObjects = 0;

  // 1. Fetch user's repos (owned + collaborator, sorted by most recently pushed)
  const reposRes = await fetch(
    `${GITHUB_API}/user/repos?per_page=30&sort=pushed&affiliation=owner,collaborator`,
    { headers },
  );
  if (!reposRes.ok) {
    if (reposRes.status === 401) throw new Error('GitHub token expired or invalid');
    if (reposRes.status === 403) throw new Error('GitHub rate limit exceeded');
    throw new Error(`GitHub API error: ${reposRes.status}`);
  }
  const repoList = (await reposRes.json()) as GitHubRepo[];
  repos = repoList.length;
  logger.info(`Found ${repos} repos`);

  // Prepared statements
  const checkExists = sqlite.prepare('SELECT id FROM objects WHERE uri = ?');
  const insertObj = sqlite.prepare(`
    INSERT INTO objects (id, source, source_type, uri, title, summary, tags, content_hash, last_synced_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertBody = sqlite.prepare(`
    INSERT OR REPLACE INTO object_bodies (object_id, content, content_type, fetched_at)
    VALUES (?, ?, ?, ?)
  `);
  const insertFts = sqlite.prepare(`
    INSERT INTO objects_fts(rowid, title, summary, tags, source, source_type, body_excerpt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const getRowid = sqlite.prepare('SELECT rowid FROM objects WHERE id = ?');

  // 2. For each repo (capped at MAX_REPOS), fetch recent issues + PRs
  for (const repo of repoList.slice(0, MAX_REPOS)) {
    try {
      // GitHub /issues endpoint returns both issues and PRs
      const issuesRes = await fetch(
        `${GITHUB_API}/repos/${repo.full_name}/issues?state=all&per_page=30&sort=updated`,
        { headers },
      );
      if (!issuesRes.ok) {
        logger.warn(`Failed to fetch issues for ${repo.full_name}: ${issuesRes.status}`);
        continue;
      }
      const issueList = (await issuesRes.json()) as GitHubIssue[];

      // Batch insert within a transaction
      const batchInsert = sqlite.transaction((items: GitHubIssue[]) => {
        for (const item of items) {
          const isPR = !!item.pull_request;
          const sourceType = isPR ? 'pull_request' : 'issue';
          const uri = `github://${repo.full_name}/${sourceType}/${item.number}`;

          if (checkExists.get(uri)) continue;

          const now = Date.now();
          const id = createId('obj');
          const title = `${repo.full_name}#${item.number}: ${item.title}`;
          const summary = item.body
            ? item.body.length > 200
              ? item.body.slice(0, 200) + '...'
              : item.body
            : item.title;
          const tags = JSON.stringify([
            'github',
            sourceType,
            item.state,
            ...item.labels.map((l) => l.name),
          ]);
          const body = formatIssueBody(item, repo.full_name);
          const hash = contentHash(title + (item.body ?? ''));

          insertObj.run(
            id,
            'github',
            sourceType,
            uri,
            title,
            summary,
            tags,
            hash,
            now,
            new Date(item.created_at).getTime(),
          );
          insertBody.run(id, body, 'text/plain', now);

          // Incremental FTS update
          try {
            const rowid = getRowid.get(id) as { rowid: number } | undefined;
            if (rowid) {
              const excerpt = body.length > 500 ? body.slice(0, 500) : body;
              insertFts.run(rowid.rowid, title, summary ?? '', tags, 'github', sourceType, excerpt);
            }
          } catch {
            /* FTS insert non-critical */
          }

          newObjects++;
          if (isPR) prs++;
          else issues++;
        }
      });

      batchInsert(issueList);
    } catch (err) {
      logger.warn(`Error syncing ${repo.full_name}: ${err}`);
    }

    // Conservative rate limiting (GitHub allows 5000 req/hr)
    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  logger.info('GitHub sync complete', { repos, issues, prs, newObjects });
  return { repos, issues, prs, newObjects };
}

function formatIssueBody(item: GitHubIssue, repo: string): string {
  return [
    `${repo}#${item.number}: ${item.title}`,
    `State: ${item.state} | Author: ${item.user?.login ?? 'unknown'} | Created: ${item.created_at}`,
    `Labels: ${item.labels.map((l) => l.name).join(', ') || 'none'}`,
    '',
    item.body ?? '(no description)',
  ].join('\n');
}
