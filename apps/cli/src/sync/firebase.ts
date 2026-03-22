import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { contentHash } from './feishu.js';
import { logInfo, logError } from '../utils/logger.js';
import type { FileWriter } from './file-writer.js';
import { formatAnalytics } from './formatters.js';

export interface FirebaseSyncLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

export interface FirebaseSyncResult {
  events: number;
  newObjects: number;
}

const defaultLogger: FirebaseSyncLogger = {
  info: (msg, ctx) => logInfo('sync', msg, ctx),
  warn: (msg, ctx) => logError('sync', msg, ctx),
  error: (msg, ctx) => logError('sync', msg, ctx),
};

/**
 * Sync Firebase Analytics event definitions and recent data.
 * Uses Google Analytics Data API (GA4).
 * Requires an API key with GA4 Data API access.
 */
export async function syncFirebase(
  sqlite: Database.Database,
  data: Record<string, string>,
  logger: FirebaseSyncLogger = defaultLogger,
  fileWriter?: FileWriter,
): Promise<FirebaseSyncResult> {
  const { projectId, apiKey } = data;
  if (!projectId) throw new Error('Missing Firebase project ID');

  let events = 0, newObjects = 0;

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

  // Google Analytics Data API (GA4)
  if (apiKey) {
    try {
      const propertyId = data.propertyId ?? projectId;
      const res = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            dateRanges: [{ startDate: '7daysAgo', endDate: 'today' }],
            dimensions: [{ name: 'eventName' }],
            metrics: [{ name: 'eventCount' }],
            limit: 50,
          }),
        },
      );

      if (res.ok) {
        const report = await res.json() as {
          rows?: Array<{
            dimensionValues: Array<{ value: string }>;
            metricValues: Array<{ value: string }>;
          }>;
        };

        const batch = sqlite.transaction((rows: NonNullable<typeof report.rows>) => {
          for (const row of rows) {
            const eventName = row.dimensionValues[0]?.value ?? 'unknown';
            const eventCount = parseInt(row.metricValues[0]?.value ?? '0');
            const uri = `firebase://${projectId}/event/${eventName}`;
            if (checkExists.get(uri)) continue;

            const nowMs = Date.now();
            const id = createId('obj');
            const summary = `${eventName}: ${eventCount} events (last 7 days)`;
            const tags = JSON.stringify(['firebase', 'analytics', 'event']);
            const body = JSON.stringify({ eventName, eventCount, period: '7daysAgo..today' }, null, 2);

            insertObj.run(id, 'firebase', 'analytics_event', uri, eventName, summary, tags, contentHash(body), nowMs, nowMs);
            insertBody.run(id, body, 'application/json', nowMs);

            // Incremental FTS
            try {
              const rowid = getRowid.get(id) as { rowid: number } | undefined;
              if (rowid) {
                insertFts.run(rowid.rowid, eventName ?? '', summary ?? '', tags, 'firebase', 'analytics_event', body.length > 500 ? body.slice(0, 500) : body);
              }
            } catch { /* FTS insert non-critical */ }

            // Write to file repo
            if (fileWriter) {
              try {
                const fileContent = formatAnalytics({ eventName, eventCount, period: '7daysAgo..today' });
                const filePath = fileWriter.writeObject('firebase', 'analytics_event', {
                  id, title: eventName,
                }, fileContent);
                sqlite.prepare('UPDATE objects SET file_path = ? WHERE id = ?').run(filePath, id);
              } catch { /* file write non-critical */ }
            }

            events++;
            newObjects++;
          }
        });
        batch(report.rows ?? []);
      } else {
        logger.warn(`Firebase Analytics API: ${res.status}`);
      }
    } catch (err) {
      logger.error(`Firebase sync error: ${err}`);
    }
  } else {
    logger.warn('Firebase sync requires apiKey. Provide via jowork connect firebase --api-key <key>');
  }

  // Update sync_cursors so `jowork status` shows last sync time
  sqlite.prepare('INSERT OR REPLACE INTO sync_cursors (connector_id, cursor, last_synced_at) VALUES (?, ?, ?)')
    .run('firebase', null, Date.now());

  logger.info('Firebase sync complete', { events, newObjects });
  return { events, newObjects };
}
