// @jowork/core/connectors/sync-scheduler — automatic connector content sync
//
// Polls every 60 seconds, checks connectors with a sync_schedule (cron expr),
// and triggers syncConnectorItems when the schedule matches.

import { getDb } from '../datamap/db.js';
import { logger, nowISO } from '../utils/index.js';
import { syncConnectorItems } from './cache.js';
import { updateLastSyncAt } from './index.js';
import type { ConnectorId } from '../types.js';

// ─── Cron matching (same logic as scheduler/index.ts) ────────────────────────

function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const check = (part: string, value: number): boolean => {
    if (part === '*') return true;
    if (part.includes('/')) {
      const [, step] = part.split('/');
      return value % parseInt(step ?? '1', 10) === 0;
    }
    return parseInt(part, 10) === value;
  };
  return (
    check(min, date.getMinutes()) &&
    check(hour, date.getHours()) &&
    check(dom, date.getDate()) &&
    check(month, date.getMonth() + 1) &&
    check(dow, date.getDay())
  );
}

// ─── Scheduler state ─────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;

interface SyncRow {
  id: string;
  sync_schedule: string;
}

async function tick(): Promise<void> {
  const db = getDb();
  const now = new Date();

  // Find all connectors with a sync_schedule set
  const rows = db.prepare(
    `SELECT id, sync_schedule FROM connectors WHERE sync_schedule IS NOT NULL`,
  ).all() as SyncRow[];

  for (const row of rows) {
    if (!matchesCron(row.sync_schedule, now)) continue;

    const connectorId = row.id as ConnectorId;
    try {
      const result = await syncConnectorItems(connectorId);
      const ts = nowISO();
      updateLastSyncAt(connectorId, ts);
      logger.info('Connector auto-sync complete', { connectorId, synced: result.synced, errors: result.errors });
    } catch (err) {
      logger.error('Connector auto-sync failed', { connectorId, err: String(err) });
    }
  }
}

/** Start the connector sync scheduler. Polls every 60 seconds. */
export function startConnectorSyncScheduler(): void {
  if (_timer) return;
  _timer = setInterval(() => void tick(), 60_000);
  logger.info('Connector sync scheduler started');
}

/** Stop the connector sync scheduler. */
export function stopConnectorSyncScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    logger.info('Connector sync scheduler stopped');
  }
}

// Expose matchesCron for testing
export { matchesCron as _matchesCronForTest };
