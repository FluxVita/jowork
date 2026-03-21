import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from './feishu.js';
import { logInfo, logError } from '../utils/logger.js';

export interface GitLabSyncLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface GitLabSyncResult {
  projects: number;
  issues: number;
  mrs: number;
  newObjects: number;
}

const defaultLogger: GitLabSyncLogger = {
  info: (msg, ctx) => logInfo('sync', msg, ctx),
  warn: (msg, ctx) => logError('sync', msg, ctx),
  error: (msg, ctx) => logError('sync', msg, ctx),
};

const MAX_PROJECTS = 20;
const RATE_LIMIT_DELAY_MS = 200;

interface GitLabProject {
  id: number;
  path_with_namespace: string;
  name: string;
  description: string | null;
  web_url: string;
  star_count: number;
  last_activity_at: string;
}

interface GitLabIssue {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  author: { username: string } | null;
  created_at: string;
  updated_at: string;
  labels: string[];
}

interface GitLabMR {
  iid: number;
  title: string;
  description: string | null;
  web_url: string;
  state: string;
  author: { username: string } | null;
  created_at: string;
  updated_at: string;
  labels: string[];
  source_branch: string;
  target_branch: string;
}

/** Sync GitLab projects, issues, and merge requests for the authenticated user. */
export async function syncGitLab(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: GitLabSyncLogger = defaultLogger,
): Promise<GitLabSyncResult> {
  const token = data.token;
  if (!token) throw new Error('Missing GitLab token');

  const baseUrl = data.apiUrl || 'https://gitlab.com';
  const headers: Record<string, string> = {
    'PRIVATE-TOKEN': token,
  };

  let projects = 0;
  let issues = 0;
  let mrs = 0;
  let newObjects = 0;

  // 1. Fetch user's projects (membership=true, sorted by last activity)
  const projectsRes = await fetch(
    `${baseUrl}/api/v4/projects?membership=true&per_page=20&order_by=last_activity_at`,
    { headers },
  );
  if (!projectsRes.ok) {
    if (projectsRes.status === 401) throw new Error('GitLab token expired or invalid');
    throw new Error(`GitLab API error: ${projectsRes.status}`);
  }
  const projectList = (await projectsRes.json()) as GitLabProject[];
  projects = projectList.length;
  logger.info(`Found ${projects} GitLab projects`);

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

  // 2. For each project, fetch recent issues + MRs
  for (const project of projectList.slice(0, MAX_PROJECTS)) {
    const encodedPath = encodeURIComponent(project.path_with_namespace);

    // Fetch issues
    try {
      const issuesRes = await fetch(
        `${baseUrl}/api/v4/projects/${encodedPath}/issues?state=all&per_page=30&order_by=updated_at`,
        { headers },
      );
      if (issuesRes.ok) {
        const issueList = (await issuesRes.json()) as GitLabIssue[];

        const batchInsert = sqlite.transaction((items: GitLabIssue[]) => {
          for (const item of items) {
            const uri = `gitlab://${project.path_with_namespace}/issue/${item.iid}`;
            if (checkExists.get(uri)) continue;

            const now = Date.now();
            const id = createId('obj');
            const title = `${project.path_with_namespace}#${item.iid}: ${item.title}`;
            const summary = item.description
              ? item.description.length > 200
                ? item.description.slice(0, 200) + '...'
                : item.description
              : item.title;
            const tags = JSON.stringify(['gitlab', 'issue', item.state, ...item.labels]);
            const body = formatGitLabIssueBody(item, project.path_with_namespace);
            const hash = contentHash(title + (item.description ?? ''));

            insertObj.run(id, 'gitlab', 'issue', uri, title, summary, tags, hash, now, new Date(item.created_at).getTime());
            insertBody.run(id, body, 'text/plain', now);

            try {
              const rowid = getRowid.get(id) as { rowid: number } | undefined;
              if (rowid) {
                const excerpt = body.length > 500 ? body.slice(0, 500) : body;
                insertFts.run(rowid.rowid, title, summary ?? '', tags, 'gitlab', 'issue', excerpt);
              }
            } catch { /* FTS insert non-critical */ }

            newObjects++;
            issues++;
          }
        });
        batchInsert(issueList);
      } else {
        logger.warn(`Failed to fetch issues for ${project.path_with_namespace}: ${issuesRes.status}`);
      }
    } catch (err) {
      logger.warn(`Error fetching issues for ${project.path_with_namespace}: ${err}`);
    }

    // Fetch merge requests
    try {
      const mrsRes = await fetch(
        `${baseUrl}/api/v4/projects/${encodedPath}/merge_requests?state=all&per_page=30&order_by=updated_at`,
        { headers },
      );
      if (mrsRes.ok) {
        const mrList = (await mrsRes.json()) as GitLabMR[];

        const batchInsert = sqlite.transaction((items: GitLabMR[]) => {
          for (const item of items) {
            const uri = `gitlab://${project.path_with_namespace}/merge_request/${item.iid}`;
            if (checkExists.get(uri)) continue;

            const now = Date.now();
            const id = createId('obj');
            const title = `${project.path_with_namespace}!${item.iid}: ${item.title}`;
            const summary = item.description
              ? item.description.length > 200
                ? item.description.slice(0, 200) + '...'
                : item.description
              : item.title;
            const tags = JSON.stringify(['gitlab', 'merge_request', item.state, ...item.labels]);
            const body = formatGitLabMRBody(item, project.path_with_namespace);
            const hash = contentHash(title + (item.description ?? ''));

            insertObj.run(id, 'gitlab', 'merge_request', uri, title, summary, tags, hash, now, new Date(item.created_at).getTime());
            insertBody.run(id, body, 'text/plain', now);

            try {
              const rowid = getRowid.get(id) as { rowid: number } | undefined;
              if (rowid) {
                const excerpt = body.length > 500 ? body.slice(0, 500) : body;
                insertFts.run(rowid.rowid, title, summary ?? '', tags, 'gitlab', 'merge_request', excerpt);
              }
            } catch { /* FTS insert non-critical */ }

            newObjects++;
            mrs++;
          }
        });
        batchInsert(mrList);
      } else {
        logger.warn(`Failed to fetch MRs for ${project.path_with_namespace}: ${mrsRes.status}`);
      }
    } catch (err) {
      logger.warn(`Error fetching MRs for ${project.path_with_namespace}: ${err}`);
    }

    await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS));
  }

  logger.info('GitLab sync complete', { projects, issues, mrs, newObjects });
  return { projects, issues, mrs, newObjects };
}

function formatGitLabIssueBody(item: GitLabIssue, project: string): string {
  return [
    `${project}#${item.iid}: ${item.title}`,
    `State: ${item.state} | Author: ${item.author?.username ?? 'unknown'} | Created: ${item.created_at}`,
    `Labels: ${item.labels.join(', ') || 'none'}`,
    '',
    item.description ?? '(no description)',
  ].join('\n');
}

function formatGitLabMRBody(item: GitLabMR, project: string): string {
  return [
    `${project}!${item.iid}: ${item.title}`,
    `State: ${item.state} | Author: ${item.author?.username ?? 'unknown'} | Created: ${item.created_at}`,
    `Branch: ${item.source_branch} → ${item.target_branch}`,
    `Labels: ${item.labels.join(', ') || 'none'}`,
    '',
    item.description ?? '(no description)',
  ].join('\n');
}
