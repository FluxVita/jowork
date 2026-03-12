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
