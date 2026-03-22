import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from './feishu.js';
import { logInfo, logError } from '../utils/logger.js';
import type { FileWriter } from './file-writer.js';
import { formatIssue } from './formatters.js';

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

function issuesQuery(afterCursor?: string | null): string {
  const afterClause = afterCursor ? `, after: "${afterCursor}"` : '';
  return `
  query {
    issues(first: 50${afterClause}, orderBy: updatedAt) {
      pageInfo { hasNextPage endCursor }
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
}

/** Sync Linear issues for the authenticated user. */
export async function syncLinear(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: LinearSyncLogger = defaultLogger,
  fileWriter?: FileWriter,
): Promise<LinearSyncResult> {
  const apiKey = data.apiKey;
  if (!apiKey) throw new Error('Missing Linear API key');

  const headers = {
    'Content-Type': 'application/json',
    Authorization: apiKey,
  };

  let issues = 0;
  let newObjects = 0;

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

  // Cursor-based pagination
  let hasNextPage = true;
  let endCursor: string | null = null;

  while (hasNextPage) {
    const res = await fetch(LINEAR_API, {
      method: 'POST',
      headers,
      body: JSON.stringify({ query: issuesQuery(endCursor) }),
    });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Linear API key expired or invalid');
      throw new Error(`Linear API error: ${res.status}`);
    }

    const body = await res.json() as {
      data?: { issues?: { pageInfo?: { hasNextPage: boolean; endCursor: string }; nodes?: LinearIssue[] } };
      errors?: Array<{ message: string }>;
    };

    if (body.errors?.length) {
      throw new Error(`Linear GraphQL error: ${body.errors[0].message}`);
    }

    const issueList = body.data?.issues?.nodes ?? [];
    issues += issueList.length;

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

        // Write to file repo
        if (fileWriter) {
          try {
            const labelNames = item.labels.nodes.map((l) => l.name);
            const fileContent = formatIssue({
              source: 'linear', repo: item.identifier.split('-')[0] ?? 'linear',
              number: parseInt(item.identifier.split('-')[1] ?? '0'),
              title: item.title, state: item.state.name,
              author: item.assignee?.name ?? 'unassigned', labels: labelNames,
              created: item.createdAt, uri: `linear://${item.identifier}`,
              body: item.description ?? '',
            });
            const filePath = fileWriter.writeObject('linear', 'issue', {
              id, identifier: item.identifier, title: item.title,
            }, fileContent);
            sqlite.prepare('UPDATE objects SET file_path = ? WHERE id = ?').run(filePath, id);
          } catch { /* file write non-critical */ }
        }

        newObjects++;
      }
    });

    batchInsert(issueList);

    hasNextPage = body.data?.issues?.pageInfo?.hasNextPage ?? false;
    endCursor = body.data?.issues?.pageInfo?.endCursor ?? null;
  }

  logger.info(`Found ${issues} Linear issues`);

  // Update sync_cursors so `jowork status` shows last sync time
  sqlite.prepare('INSERT OR REPLACE INTO sync_cursors (connector_id, cursor, last_synced_at) VALUES (?, ?, ?)')
    .run('linear', null, Date.now());

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
