import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from './feishu.js';
import { logInfo, logError } from '../utils/logger.js';

export interface PostHogSyncLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface PostHogSyncResult {
  events: number;
  insights: number;
  newObjects: number;
}

const defaultLogger: PostHogSyncLogger = {
  info: (msg, ctx) => logInfo('sync', msg, ctx),
  warn: (msg, ctx) => logError('sync', msg, ctx),
  error: (msg, ctx) => logError('sync', msg, ctx),
};

/**
 * Sync PostHog data: insights (saved queries), event definitions, and key metrics.
 * PostHog API: https://posthog.com/docs/api
 */
export async function syncPostHog(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: PostHogSyncLogger = defaultLogger,
): Promise<PostHogSyncResult> {
  const { apiKey, host, projectId: rawProjectId } = data;
  if (!apiKey) throw new Error('Missing PostHog API key');
  const baseUrl = host || 'https://app.posthog.com';
  const projectId = rawProjectId || '1';

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  let events = 0, insights = 0, newObjects = 0;

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

  // 1. Fetch saved insights (dashboards, trends, funnels)
  try {
    const insightsRes = await fetch(`${baseUrl}/api/projects/${projectId}/insights/?limit=50`, { headers });
    if (insightsRes.ok) {
      const insightsData = await insightsRes.json() as {
        results: Array<{
          id: number; name: string; description: string | null;
          filters: Record<string, unknown>; last_refresh: string;
          result?: unknown;
        }>;
      };

      const batch = sqlite.transaction((items: typeof insightsData.results) => {
        for (const insight of items) {
          const uri = `posthog://insight/${insight.id}`;
          if (checkExists.get(uri)) continue;

          const now = Date.now();
          const id = createId('obj');
          const summary = insight.description || `Insight: ${insight.name}`;
          const tags = JSON.stringify(['posthog', 'insight', ...Object.keys(insight.filters).slice(0, 3)]);
          const body = JSON.stringify({
            name: insight.name,
            description: insight.description,
            filters: insight.filters,
            lastRefresh: insight.last_refresh,
          }, null, 2);

          insertObj.run(id, 'posthog', 'insight', uri, insight.name, summary, tags, contentHash(body), now, now);
          insertBody.run(id, body, 'application/json', now);

          // Incremental FTS
          try {
            const rowid = getRowid.get(id) as { rowid: number } | undefined;
            if (rowid) {
              const excerpt = body.length > 500 ? body.slice(0, 500) : body;
              insertFts.run(rowid.rowid, insight.name ?? '', summary ?? '', tags, 'posthog', 'insight', excerpt);
            }
          } catch { /* FTS insert non-critical */ }

          insights++;
          newObjects++;
        }
      });
      batch(insightsData.results ?? []);
      logger.info(`Synced ${insights} insights`);
    } else {
      logger.warn(`Failed to fetch insights: ${insightsRes.status}`);
    }
  } catch (err) {
    logger.error(`Insights sync error: ${err}`);
  }

  // 2. Fetch event definitions (what events are tracked)
  try {
    const eventsRes = await fetch(`${baseUrl}/api/projects/${projectId}/event_definitions/?limit=100`, { headers });
    if (eventsRes.ok) {
      const eventsData = await eventsRes.json() as {
        results: Array<{
          id: string; name: string; description: string | null;
          volume_30_day: number | null; query_usage_30_day: number | null;
        }>;
      };

      const batch = sqlite.transaction((items: typeof eventsData.results) => {
        for (const event of items) {
          const uri = `posthog://event/${event.name}`;
          if (checkExists.get(uri)) continue;

          const now = Date.now();
          const id = createId('obj');
          const summary = `${event.name}: ${event.description ?? 'no description'} (30d volume: ${event.volume_30_day ?? 'N/A'})`;
          const tags = JSON.stringify(['posthog', 'event_definition']);
          const body = JSON.stringify(event, null, 2);

          insertObj.run(id, 'posthog', 'event_definition', uri, event.name, summary, tags, contentHash(body), now, now);
          insertBody.run(id, body, 'application/json', now);

          // Incremental FTS
          try {
            const rowid = getRowid.get(id) as { rowid: number } | undefined;
            if (rowid) {
              const excerpt = body.length > 500 ? body.slice(0, 500) : body;
              insertFts.run(rowid.rowid, event.name ?? '', summary ?? '', tags, 'posthog', 'event_definition', excerpt);
            }
          } catch { /* FTS insert non-critical */ }

          events++;
          newObjects++;
        }
      });
      batch(eventsData.results ?? []);
      logger.info(`Synced ${events} event definitions`);
    }
  } catch (err) {
    logger.error(`Events sync error: ${err}`);
  }

  logger.info('PostHog sync complete', { events, insights, newObjects });
  return { events, insights, newObjects };
}
