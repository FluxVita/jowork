// @jowork/core/services — graceful shutdown
//
// Order:
//  1. Stop accepting new connections (server.close)
//  2. Wait up to timeoutMs for active requests to drain
//  3. WAL checkpoint (flush SQLite WAL → main DB file)
//  4. Close database

import type { Server } from 'node:http';
import type Database from 'better-sqlite3';
import { logger } from '../utils/index.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export async function gracefulShutdown(
  server: Server,
  db: Database.Database,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<void> {
  logger.info('Graceful shutdown initiated');

  // 1. Stop accepting new connections; wait for active ones to drain
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn('Graceful shutdown: connection drain timeout, proceeding');
      resolve();
    }, timeoutMs);

    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  logger.info('Graceful shutdown: HTTP server closed');

  // 2. Flush WAL to main DB file before closing
  try {
    db.pragma('wal_checkpoint(FULL)');
    logger.info('Graceful shutdown: WAL checkpoint complete');
  } catch (err) {
    logger.warn('Graceful shutdown: WAL checkpoint failed', { err: String(err) });
  }

  // 3. Close DB
  try {
    db.close();
    logger.info('Graceful shutdown: database closed');
  } catch (err) {
    logger.warn('Graceful shutdown: database close failed', { err: String(err) });
  }

  logger.info('Graceful shutdown complete');
}
