// @jowork/core/datamap — SQLite connection singleton

import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { logger } from '../utils/index.js';

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!_db) {
    throw new Error('DB not initialized. Call initDb() first.');
  }
  return _db;
}

/** Open (or create) the SQLite database. Idempotent. */
export function openDb(dataDir = config.dataDir): Database.Database {
  if (_db) return _db;
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'jowork.db');
  _db = new Database(dbPath);
  // Performance defaults
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  _db.pragma('busy_timeout = 5000');
  logger.info('Database opened', { path: dbPath });
  return _db;
}

/** Close the database (useful for tests). */
export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}
