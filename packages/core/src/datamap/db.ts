// @jowork/core/datamap — SQLite connection singleton
// Supports both better-sqlite3 (Node.js) and bun:sqlite (Bun sidecar via setDb)

import type Database from 'better-sqlite3';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../utils/index.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('DB not initialized. Call openDb() first.');
  }
  return _db;
}

/** Open (or create) the SQLite database using better-sqlite3. Idempotent. */
export function openDb(dataDir = config.dataDir): Database.Database {
  if (_db) return _db;
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'jowork.db');
  // Dynamic require to avoid top-level import of native addon
  // (allows Bun sidecar to skip better-sqlite3 entirely via setDb)
  const req = createRequire(import.meta.url);
  const DatabaseCtor = req('better-sqlite3') as typeof Database;
  _db = new DatabaseCtor(dbPath);
  // Performance defaults
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  logger.info('Database opened', { path: dbPath });
  return _db;
}

/**
 * Inject a pre-created database instance (for Bun sidecar / alternative drivers).
 * The injected db must be API-compatible with better-sqlite3:
 *   .prepare(), .exec(), .pragma(), .transaction(), .close()
 */
export function setDb(db: Database.Database): void {
  _db = db;
}

/** Close the database (useful for tests). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
