// @jowork/core/services/backup-scheduler
//
// Schedules a daily automatic database backup (default: 03:00 local time).
// Uses a recursive setTimeout to avoid drift that setInterval accumulates.

import type Database from 'better-sqlite3';
import { backupDb } from '../datamap/migrator.js';
import { logger } from '../utils/index.js';

let _timer: ReturnType<typeof setTimeout> | null = null;

/** Milliseconds until the next occurrence of HH:MM (local time). */
function msUntilNext(hour: number, minute: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hour, minute, 0, 0);
  if (target <= now) {
    target.setDate(target.getDate() + 1);
  }
  return target.getTime() - now.getTime();
}

async function runBackup(db: Database.Database, dataDir: string): Promise<void> {
  try {
    const path = await backupDb(db, dataDir);
    logger.info('Scheduled DB backup complete', { path });
  } catch (err) {
    logger.error('Scheduled DB backup failed', { err: String(err) });
  }
}

function scheduleNext(db: Database.Database, dataDir: string, hour: number, minute: number): void {
  const delay = msUntilNext(hour, minute);
  _timer = setTimeout(async () => {
    await runBackup(db, dataDir);
    scheduleNext(db, dataDir, hour, minute);
  }, delay);
}

/**
 * Start the automatic daily backup scheduler.
 *
 * @param db       Open database handle
 * @param dataDir  Directory for backup files (passed to backupDb)
 * @param hour     Local-time hour to run (default: 3 = 03:00)
 * @param minute   Local-time minute to run (default: 0)
 */
export function startBackupScheduler(
  db: Database.Database,
  dataDir: string,
  hour = 3,
  minute = 0,
): void {
  stopBackupScheduler();
  scheduleNext(db, dataDir, hour, minute);
  const nextRun = new Date(Date.now() + msUntilNext(hour, minute)).toISOString();
  logger.info('Daily backup scheduler started', { nextRun, hour, minute });
}

/** Stop the scheduled backup timer. */
export function stopBackupScheduler(): void {
  if (_timer) {
    clearTimeout(_timer);
    _timer = null;
  }
}
