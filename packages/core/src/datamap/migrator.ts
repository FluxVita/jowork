// @jowork/core/datamap — schema migration runner
//
// Design:
//   - schema_migrations table tracks applied migrations by name
//   - Migrations run in order inside a transaction
//   - Before running any pending migrations, the DB is backed up to data/backups/
//   - Bootstrap: if schema_migrations is empty but other tables exist,
//     record 001_initial as already applied (existing installation compatibility)

import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { logger } from '../utils/index.js';

// ─── Migration definitions ────────────────────────────────────────────────────

interface Migration {
  name: string;
  up(db: Database.Database): void;
}

const MIGRATIONS: Migration[] = [
  {
    name: '001_initial',
    up(db) {
      // Baseline schema — matches init.ts exactly; idempotent via IF NOT EXISTS
      db.exec(`
        CREATE TABLE IF NOT EXISTS users (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          email         TEXT NOT NULL UNIQUE,
          role          TEXT NOT NULL DEFAULT 'member',
          password_hash TEXT,
          created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agents (
          id            TEXT PRIMARY KEY,
          name          TEXT NOT NULL,
          owner_id      TEXT NOT NULL REFERENCES users(id),
          system_prompt TEXT NOT NULL DEFAULT '',
          model         TEXT NOT NULL DEFAULT 'claude-3-5-sonnet-latest',
          created_at    TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS sessions (
          id         TEXT PRIMARY KEY,
          agent_id   TEXT NOT NULL REFERENCES agents(id),
          user_id    TEXT NOT NULL REFERENCES users(id),
          title      TEXT NOT NULL DEFAULT 'New session',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS messages (
          id           TEXT PRIMARY KEY,
          session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          role         TEXT NOT NULL,
          content      TEXT NOT NULL,
          tool_calls   TEXT,
          tool_results TEXT,
          created_at   TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS memories (
          id          TEXT PRIMARY KEY,
          user_id     TEXT NOT NULL REFERENCES users(id),
          content     TEXT NOT NULL,
          tags        TEXT NOT NULL DEFAULT '[]',
          source      TEXT NOT NULL DEFAULT 'user',
          sensitivity TEXT NOT NULL DEFAULT 'internal',
          created_at  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
          content,
          content='memories',
          content_rowid='rowid'
        );

        CREATE TABLE IF NOT EXISTS connectors (
          id         TEXT PRIMARY KEY,
          kind       TEXT NOT NULL,
          name       TEXT NOT NULL,
          settings   TEXT NOT NULL DEFAULT '{}',
          owner_id   TEXT NOT NULL REFERENCES users(id),
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scheduler_tasks (
          id          TEXT PRIMARY KEY,
          agent_id    TEXT NOT NULL REFERENCES agents(id),
          user_id     TEXT NOT NULL REFERENCES users(id),
          name        TEXT NOT NULL,
          cron_expr   TEXT NOT NULL,
          action      TEXT NOT NULL,
          params      TEXT NOT NULL DEFAULT '{}',
          enabled     INTEGER NOT NULL DEFAULT 1,
          last_run_at TEXT,
          next_run_at TEXT,
          created_at  TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS context_docs (
          id          TEXT PRIMARY KEY,
          layer       TEXT NOT NULL,
          scope_id    TEXT NOT NULL,
          title       TEXT NOT NULL,
          content     TEXT NOT NULL,
          doc_type    TEXT NOT NULL DEFAULT 'workstyle',
          is_forced   INTEGER NOT NULL DEFAULT 0,
          sensitivity TEXT NOT NULL DEFAULT 'internal',
          created_by  TEXT NOT NULL,
          updated_at  TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS context_docs_fts USING fts5(
          title,
          content,
          content='context_docs',
          content_rowid='rowid'
        );
      `);
    },
  },
  {
    name: '002_messages_fts',
    up(db) {
      db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          content='messages',
          content_rowid='rowid'
        );
        -- Backfill existing messages into FTS index
        INSERT INTO messages_fts(rowid, content) SELECT rowid, content FROM messages;
      `);
    },
  },
  {
    name: '003_connector_items',
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS connector_items (
          id            TEXT PRIMARY KEY,
          connector_id  TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE,
          uri           TEXT NOT NULL,
          title         TEXT NOT NULL,
          content       TEXT NOT NULL,
          content_type  TEXT NOT NULL DEFAULT 'text/plain',
          url           TEXT,
          sensitivity   TEXT NOT NULL DEFAULT 'internal',
          fetched_at    TEXT NOT NULL,
          UNIQUE(connector_id, uri)
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS connector_items_fts USING fts5(
          title,
          content,
          content='connector_items',
          content_rowid='rowid'
        );
      `);
    },
  },
  {
    name: '004_connector_sync_schedule',
    up(db) {
      // Add sync_schedule (cron expr) and last_sync_at columns to connectors table.
      // ALTER TABLE ADD COLUMN is idempotent-safe via IF NOT EXISTS check.
      const cols = db.prepare(`PRAGMA table_info(connectors)`).all() as Array<{ name: string }>;
      const colNames = new Set(cols.map(c => c.name));
      if (!colNames.has('sync_schedule')) {
        db.exec(`ALTER TABLE connectors ADD COLUMN sync_schedule TEXT`);
      }
      if (!colNames.has('last_sync_at')) {
        db.exec(`ALTER TABLE connectors ADD COLUMN last_sync_at TEXT`);
      }
    },
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureMigrationsTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);
}

function appliedMigrations(db: Database.Database): Set<string> {
  const rows = db
    .prepare(`SELECT name FROM schema_migrations ORDER BY name`)
    .all() as Array<{ name: string }>;
  return new Set(rows.map(r => r.name));
}

function tablesExist(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS cnt FROM sqlite_master WHERE type='table' AND name='users'`)
    .get() as { cnt: number };
  return row.cnt > 0;
}

// ─── Backup ───────────────────────────────────────────────────────────────────

const MAX_BACKUPS = 5;

/**
 * Hot-backup the SQLite database to `{dataDir}/backups/`.
 * Returns the backup file path.
 */
export async function backupDb(db: Database.Database, dataDir: string): Promise<string> {
  const backupDir = join(dataDir, 'backups');
  mkdirSync(backupDir, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(backupDir, `jowork-backup-${ts}.db`);

  await db.backup(dest);
  logger.info('DB backup created', { path: dest });

  // Prune oldest backups beyond MAX_BACKUPS
  try {
    const files = readdirSync(backupDir)
      .filter(f => f.startsWith('jowork-backup-') && f.endsWith('.db'))
      .sort(); // ISO timestamps sort chronologically
    if (files.length > MAX_BACKUPS) {
      const { unlinkSync } = await import('node:fs');
      for (const old of files.slice(0, files.length - MAX_BACKUPS)) {
        unlinkSync(join(backupDir, old));
        logger.info('DB backup pruned', { file: old });
      }
    }
  } catch (err) {
    logger.warn('Backup pruning failed', { err: String(err) });
  }

  return dest;
}

// ─── Migrator ────────────────────────────────────────────────────────────────

export interface MigrateOptions {
  /** If truthy, back up the DB before running pending migrations */
  dataDir?: string;
}

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

/**
 * Run pending migrations in order.
 * Existing installations that used initSchema() directly are bootstrapped
 * by marking 001_initial as applied if users table already exists.
 */
export async function migrate(
  db: Database.Database,
  opts: MigrateOptions = {},
): Promise<MigrateResult> {
  ensureMigrationsTable(db);
  const applied = appliedMigrations(db);

  // Bootstrap: if no migrations recorded yet but schema already exists, mark 001_initial as applied
  if (applied.size === 0 && tablesExist(db)) {
    const now = new Date().toISOString();
    db.prepare(`INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)`).run('001_initial', now);
    applied.add('001_initial');
    logger.info('Migration bootstrap: marked 001_initial as applied for existing DB');
  }

  const pending = MIGRATIONS.filter(m => !applied.has(m.name));

  if (pending.length === 0) {
    return { applied: [], skipped: MIGRATIONS.map(m => m.name) };
  }

  // Backup before migrating (if dataDir provided)
  if (opts.dataDir) {
    try {
      await backupDb(db, opts.dataDir);
    } catch (err) {
      logger.warn('Pre-migration backup failed, continuing', { err: String(err) });
    }
  }

  const appliedNames: string[] = [];
  for (const migration of pending) {
    const now = new Date().toISOString();
    db.transaction(() => {
      migration.up(db);
      db.prepare(`INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)`).run(migration.name, now);
    })();
    appliedNames.push(migration.name);
    logger.info('Migration applied', { name: migration.name });
  }

  return {
    applied: appliedNames,
    skipped: MIGRATIONS.filter(m => !appliedNames.includes(m.name)).map(m => m.name),
  };
}

/** List all migrations with their status. */
export function listMigrations(db: Database.Database): Array<{ name: string; applied: boolean; appliedAt?: string }> {
  ensureMigrationsTable(db);
  const rows = db
    .prepare(`SELECT name, applied_at FROM schema_migrations`)
    .all() as Array<{ name: string; applied_at: string }>;
  const appliedMap = new Map(rows.map(r => [r.name, r.applied_at]));

  return MIGRATIONS.map(m => {
    const appliedAt = appliedMap.get(m.name);
    return {
      name: m.name,
      applied: appliedMap.has(m.name),
      ...(appliedAt !== undefined ? { appliedAt } : {}),
    };
  });
}
