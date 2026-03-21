import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from './feishu.js';
import { logInfo, logError } from '../utils/logger.js';

export interface LinearSyncLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface LinearSyncResult {
  issues: number;
  newObjects: number;
}

const defaultLogger: LinearSyncLogger = {
  info: (msg, ctx) => logInfo('sync', msg, ctx),
  warn: (msg, ctx) => logError('sync', msg, ctx),
  error: (msg, ctx) => logError('sync', msg, ctx),
};

const LINEAR_API = 'https://api.linear.app/graphql';

interface LinearIssue {
  id: string;
  identifier: string;
  title: string;
  description: string | null;
  url: string;
  state: { name: string };
  assignee: { name: string } | null;
  labels: { nodes: Array<{ name: string }> };
  createdAt: string;
  updatedAt: string;
}

const ISSUES_QUERY = `
  query {
    issues(first: 50, orderBy: updatedAt) {
      nodes {
        id
        identifier
        title
        description
        url
        state { name }
        assignee { name }
        labels { nodes { name } }
        createdAt
        updatedAt
      }
    }
  }
`;

/** Sync Linear issues for the authenticated user. */
export async function syncLinear(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: LinearSyncLogger = defaultLogger,
): Promise<LinearSyncResult> {
  const apiKey = data.apiKey;
  if (!apiKey) throw new Error('Missing Linear API key');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: apiKey,
  };

  let issues = 0;
  let newObjects = 0;

  // Fetch issues via GraphQL
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: ISSUES_QUERY }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('Linear API key expired or invalid');
    throw new Error(`Linear API error: ${res.status}`);
  }

  const body = await res.json() as {
    data?: { issues?: { nodes?: LinearIssue[] } };
    errors?: Array<{ message: string }>;
  };

  if (body.errors?.length) {
    throw new Error(`Linear GraphQL error: ${body.errors[0].message}`);
  }

  const issueList = body.data?.issues?.nodes ?? [];
  issues = issueList.length;
  logger.info(`Found ${issues} Linear issues`);

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

  const batchInsert = sqlite.transaction((items: LinearIssue[]) => {
    for (const item of items) {
      const uri = `linear://${item.identifier}`;
      if (checkExists.get(uri)) continue;

      const now = Date.now();
      const id = createId('obj');
      const title = `${item.identifier}: ${item.title}`;
      const summary = item.description
        ? item.description.length > 200
          ? item.description.slice(0, 200) + '...'
          : item.description
        : item.title;
      const labelNames = item.labels.nodes.map((l) => l.name);
      const tags = JSON.stringify(['linear', 'issue', item.state.name, ...labelNames]);
      const bodyText = formatLinearIssueBody(item);
      const hash = contentHash(title + (item.description ?? ''));

      insertObj.run(id, 'linear', 'issue', uri, title, summary, tags, hash, now, new Date(item.createdAt).getTime());
      insertBody.run(id, bodyText, 'text/plain', now);

      try {
        const rowid = getRowid.get(id) as { rowid: number } | undefined;
        if (rowid) {
          const excerpt = bodyText.length > 500 ? bodyText.slice(0, 500) : bodyText;
          insertFts.run(rowid.rowid, title, summary ?? '', tags, 'linear', 'issue', excerpt);
        }
      } catch { /* FTS insert non-critical */ }

      newObjects++;
    }
  });

  batchInsert(issueList);

  logger.info('Linear sync complete', { issues, newObjects });
  return { issues, newObjects };
}

function formatLinearIssueBody(item: LinearIssue): string {
  return [
    `${item.identifier}: ${item.title}`,
    `State: ${item.state.name} | Assignee: ${item.assignee?.name ?? 'unassigned'} | Created: ${item.createdAt}`,
    `Labels: ${item.labels.nodes.map((l) => l.name).join(', ') || 'none'}`,
    '',
    item.description ?? '(no description)',
  ].join('\n');
}
