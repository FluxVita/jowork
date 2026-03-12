import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  engineId: text('engine_id').notNull(),
  mode: text('mode').notNull().default('personal'),
  messageCount: integer('message_count').default(0),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => sessions.id),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolName: text('tool_name'),
  tokens: integer('tokens'),
  cost: integer('cost'),
  createdAt: integer('created_at').notNull(),
});

export const engineSessionMappings = sqliteTable('engine_session_mappings', {
  sessionId: text('session_id').notNull().references(() => sessions.id),
  engineId: text('engine_id').notNull(),
  engineSessionId: text('engine_session_id').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({ columns: [t.sessionId, t.engineId] })]);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

// --- Phase 2: Connector + MCP ---

export const connectorConfigs = sqliteTable('connector_configs', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('disconnected'),
  config: text('config').notNull().default('{}'),
  lastSyncAt: integer('last_sync_at'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const objects = sqliteTable('objects', {
  id: text('id').primaryKey(),
  source: text('source').notNull(),
  sourceType: text('source_type').notNull(),
  uri: text('uri').notNull().unique(),
  title: text('title'),
  summary: text('summary'),
  tags: text('tags'),
  lastSyncedAt: integer('last_synced_at'),
  createdAt: integer('created_at'),
});

export const objectBodies = sqliteTable('object_bodies', {
  objectId: text('object_id').primaryKey().references(() => objects.id),
  content: text('content').notNull(),
  contentType: text('content_type'),
  fetchedAt: integer('fetched_at'),
});

export const syncCursors = sqliteTable('sync_cursors', {
  connectorId: text('connector_id').primaryKey(),
  cursor: text('cursor'),
  lastSyncedAt: integer('last_synced_at'),
});
