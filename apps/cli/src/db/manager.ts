import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { logInfo, logError } from '../utils/logger.js';

/** Ordered list of migration SQL. Each entry runs in its own transaction. */
const MIGRATIONS: string[] = [
  // 001 — Base tables
  `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS connector_configs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'disconnected',
      config TEXT NOT NULL DEFAULT '{}',
      last_sync_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS objects (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_type TEXT NOT NULL,
      uri TEXT NOT NULL UNIQUE,
      title TEXT,
      summary TEXT,
      tags TEXT,
      doc_map TEXT,
      content_hash TEXT,
      last_synced_at INTEGER,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS object_bodies (
      object_id TEXT PRIMARY KEY REFERENCES objects(id),
      content TEXT NOT NULL,
      content_type TEXT,
      fetched_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS object_chunks (
      id TEXT PRIMARY KEY,
      object_id TEXT NOT NULL REFERENCES objects(id),
      idx INTEGER NOT NULL,
      heading TEXT,
      content TEXT NOT NULL,
      tokens INTEGER,
      UNIQUE(object_id, idx)
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_object ON object_chunks(object_id);

    CREATE TABLE IF NOT EXISTS sync_cursors (
      connector_id TEXT PRIMARY KEY,
      cursor TEXT,
      last_synced_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      scope TEXT NOT NULL DEFAULT 'personal',
      pinned INTEGER DEFAULT 0,
      source TEXT,
      access_count INTEGER NOT NULL DEFAULT 0,
      last_used_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_scope ON memories(scope);
  `,

  // 002 — Object links
  `
    CREATE TABLE IF NOT EXISTS object_links (
      id TEXT PRIMARY KEY,
      source_object_id TEXT NOT NULL,
      target_object_id TEXT,
      link_type TEXT NOT NULL,
      identifier TEXT NOT NULL,
      metadata TEXT,
      confidence TEXT DEFAULT 'medium',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_object_links_source ON object_links(source_object_id);
    CREATE INDEX IF NOT EXISTS idx_object_links_target ON object_links(target_object_id);
    CREATE INDEX IF NOT EXISTS idx_object_links_type ON object_links(link_type);
  `,

  // 003 — Goal-Signal-Measure system
  `
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      autonomy_level TEXT NOT NULL DEFAULT 'copilot',
      parent_id TEXT,
      evolved_from TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS signals (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id),
      title TEXT NOT NULL,
      source TEXT NOT NULL,
      metric TEXT NOT NULL,
      direction TEXT NOT NULL,
      poll_interval INTEGER DEFAULT 3600,
      config TEXT,
      current_value REAL,
      last_polled_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS measures (
      id TEXT PRIMARY KEY,
      signal_id TEXT NOT NULL REFERENCES signals(id),
      threshold REAL NOT NULL,
      comparison TEXT NOT NULL,
      upper_bound REAL,
      current REAL,
      met INTEGER DEFAULT 0,
      last_evaluated_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_goals_status ON goals(status);
    CREATE INDEX IF NOT EXISTS idx_signals_goal ON signals(goal_id);
    CREATE INDEX IF NOT EXISTS idx_measures_signal ON measures(signal_id);
  `,

  // 004 — Add links_processed flag to objects
  `
    ALTER TABLE objects ADD COLUMN links_processed INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_objects_links_processed ON objects(links_processed);
  `,

  // 005 — Multi-layer memory (hot + warm)
  `
    CREATE TABLE IF NOT EXISTS memory_hot (
      id TEXT PRIMARY KEY,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      summary TEXT NOT NULL,
      source_count INTEGER NOT NULL DEFAULT 0,
      sources TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memory_warm (
      id TEXT PRIMARY KEY,
      goal_id TEXT,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      summary TEXT NOT NULL,
      key_decisions TEXT,
      trends TEXT,
      source_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_memory_hot_window ON memory_hot(window_start, window_end);
    CREATE INDEX IF NOT EXISTS idx_memory_warm_goal ON memory_warm(goal_id);
    CREATE INDEX IF NOT EXISTS idx_memory_warm_period ON memory_warm(period_start, period_end);
  `,

  // 006 — Sync queue for device-to-device sync
  `
    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY,
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      data TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      device_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      synced_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_unsynced ON sync_queue(synced_at) WHERE synced_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_sync_queue_table ON sync_queue(table_name, record_id);
  `,
];

export class DbManager {
  private db: BetterSQLite3Database;
  private sqlite: Database.Database;

  constructor(dbPath: string) {
    this.sqlite = new Database(dbPath);
    this.sqlite.pragma('journal_mode = WAL');
    this.sqlite.pragma('busy_timeout = 5000');
    this.sqlite.pragma('foreign_keys = ON');
    this.db = drizzle(this.sqlite);
    logInfo('database', 'Database opened', { dbPath });
  }

  /** Run all pending migrations, then ensure FTS virtual tables. */
  migrate(): void {
    // Ensure schema_version table
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY
      );
    `);

    const currentRow = this.sqlite.prepare(
      'SELECT MAX(version) AS v FROM schema_version',
    ).get() as { v: number | null } | undefined;
    const current = currentRow?.v ?? 0;

    for (let i = current; i < MIGRATIONS.length; i++) {
      const version = i + 1;
      const sql = MIGRATIONS[i];
      const txn = this.sqlite.transaction(() => {
        this.sqlite.exec(sql);
        this.sqlite.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
      });
      try {
        txn();
        logInfo('database', `Migration ${String(version).padStart(3, '0')} applied`);
      } catch (err) {
        logError('database', `Migration ${String(version).padStart(3, '0')} failed`, {
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
    }

    // FTS5 virtual tables — doesn't support IF NOT EXISTS, check manually
    this.ensureFts();
  }

  private ensureFts(): void {
    const ftsCheck = this.sqlite.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('objects_fts', 'memories_fts')`,
    ).all() as Array<{ name: string }>;
    const existing = new Set(ftsCheck.map((r) => r.name));

    if (!existing.has('objects_fts')) {
      this.sqlite.exec(`
        CREATE VIRTUAL TABLE objects_fts USING fts5(
          title, summary, tags, source, source_type, body_excerpt,
          content=''
        );
      `);
      logInfo('database', 'Created objects_fts virtual table');
    }

    if (!existing.has('memories_fts')) {
      this.sqlite.exec(`
        CREATE VIRTUAL TABLE memories_fts USING fts5(
          title, content, tags,
          content=''
        );
      `);
      // Backfill existing memories
      const rows = this.sqlite.prepare(
        `SELECT rowid, title, content, COALESCE(tags, '') AS tags FROM memories`,
      ).all() as Array<{ rowid: number; title: string; content: string; tags: string }>;
      if (rows.length > 0) {
        const insert = this.sqlite.prepare(
          `INSERT INTO memories_fts(rowid, title, content, tags) VALUES (?, ?, ?, ?)`,
        );
        for (const r of rows) {
          insert.run(r.rowid, r.title, r.content, r.tags);
        }
        logInfo('database', `Backfilled ${rows.length} memories into FTS`);
      }
      logInfo('database', 'Created memories_fts virtual table');
    }
  }

  /** Convenience: migrate + return self for chaining. */
  ensureTables(): this {
    this.migrate();
    return this;
  }

  getDb(): BetterSQLite3Database {
    return this.db;
  }

  getSqlite(): Database.Database {
    return this.sqlite;
  }

  close(): void {
    try {
      this.sqlite.close();
      logInfo('database', 'Database closed');
    } catch {
      // Already closed — safe to ignore
    }
  }
}
