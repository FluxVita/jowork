// @jowork/core/datamap — schema initialization (CREATE TABLE IF NOT EXISTS)

import type Database from 'better-sqlite3';
import { USAGE_SCHEMA } from './usage.js';

const SCHEMA = `
-- Users
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  role        TEXT NOT NULL DEFAULT 'member',
  password_hash TEXT,
  created_at  TEXT NOT NULL
);

-- Agents
CREATE TABLE IF NOT EXISTS agents (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  owner_id      TEXT NOT NULL REFERENCES users(id),
  system_prompt TEXT NOT NULL DEFAULT '',
  model         TEXT NOT NULL DEFAULT 'claude-3-5-sonnet-latest',
  created_at    TEXT NOT NULL
);

-- Sessions
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(id),
  user_id    TEXT NOT NULL REFERENCES users(id),
  title      TEXT NOT NULL DEFAULT 'New session',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Messages
CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  tool_calls  TEXT,
  tool_results TEXT,
  created_at  TEXT NOT NULL
);

-- Messages FTS
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content='messages',
  content_rowid='rowid'
);

-- Memory
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

-- Memory FTS
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content='memories',
  content_rowid='rowid'
);

-- Connectors
CREATE TABLE IF NOT EXISTS connectors (
  id            TEXT PRIMARY KEY,
  kind          TEXT NOT NULL,
  name          TEXT NOT NULL,
  settings      TEXT NOT NULL DEFAULT '{}',
  owner_id      TEXT NOT NULL REFERENCES users(id),
  sync_schedule TEXT,
  last_sync_at  TEXT,
  created_at    TEXT NOT NULL
);

-- Connector items cache (synced content from connectors)
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

-- Scheduler tasks
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

-- Context docs (three-layer context system)
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
`;

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA);
  db.exec(USAGE_SCHEMA);
}
