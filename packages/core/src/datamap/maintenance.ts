// @jowork/core/datamap/maintenance — scheduled DB cleanup and optimization
//
// Runs:
//   - TTL cleanup: delete old messages and memories past retention window
//   - PRAGMA optimize: let SQLite recalculate query planner statistics
//
// Intended to be called by the Scheduler (e.g., daily at 03:00).

import { getDb } from './db.js';
import { logger } from '../utils/index.js';

export interface MaintenanceOptions {
  /** Retain messages for this many days (default: 90) */
  messageRetentionDays?: number;
  /** Retain memories for this many days (default: 365) */
  memoryRetentionDays?: number;
}

export interface MaintenanceResult {
  deletedMessages: number;
  deletedMemories: number;
  optimized: boolean;
}

/**
 * Run database maintenance: TTL-based cleanup and SQLite optimization.
 * Safe to call concurrently — all statements run inside a single transaction.
 */
export function runMaintenance(opts: MaintenanceOptions = {}): MaintenanceResult {
  const db = getDb();
  const messageDays = opts.messageRetentionDays ?? 90;
  const memoryDays = opts.memoryRetentionDays ?? 365;

  const messageCutoff = new Date(Date.now() - messageDays * 86_400_000).toISOString();
  const memoryCutoff = new Date(Date.now() - memoryDays * 86_400_000).toISOString();

  let deletedMessages = 0;
  let deletedMemories = 0;

  const tx = db.transaction(() => {
    // Delete old messages (cascades from sessions with no recent activity)
    const msgResult = db.prepare(
      `DELETE FROM messages WHERE created_at < ?`,
    ).run(messageCutoff);
    deletedMessages = msgResult.changes;

    // Delete old memories
    const memResult = db.prepare(
      `DELETE FROM memories WHERE created_at < ?`,
    ).run(memoryCutoff);
    deletedMemories = memResult.changes;

    // Rebuild FTS index after deletion to stay consistent
    if (deletedMemories > 0) {
      db.prepare(`INSERT INTO memories_fts(memories_fts) VALUES ('rebuild')`).run();
    }
  });

  tx();

  // PRAGMA optimize is safe outside transactions
  db.pragma('optimize');

  logger.info('DB maintenance complete', {
    deletedMessages,
    deletedMemories,
    messageCutoff,
    memoryCutoff,
  });

  return { deletedMessages, deletedMemories, optimized: true };
}
