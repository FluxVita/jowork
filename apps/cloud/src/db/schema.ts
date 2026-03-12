import { pgTable, text, timestamp, integer, boolean, jsonb } from 'drizzle-orm/pg-core';

// --- Users ---
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  plan: text('plan').notNull().default('free'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- Teams ---
export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').references(() => users.id).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Cloud Credentials (for cloud-side connector execution) ---
export const cloudCredentials = pgTable('cloud_credentials', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  connectorId: text('connector_id').notNull(),
  encryptedCredentials: text('encrypted_credentials').notNull(),
  authorizedAt: timestamp('authorized_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
});

// --- Scheduled Tasks (cloud-synced) ---
export const cloudScheduledTasks = pgTable('cloud_scheduled_tasks', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  name: text('name').notNull(),
  cronExpression: text('cron_expression').notNull(),
  timezone: text('timezone').default('Asia/Shanghai'),
  type: text('type').notNull(),
  config: jsonb('config'),
  enabled: boolean('enabled').default(true),
  lastRunAt: timestamp('last_run_at'),
  nextRunAt: timestamp('next_run_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Task Execution Log ---
export const taskExecutionLog = pgTable('task_execution_log', {
  id: text('id').primaryKey(),
  taskId: text('task_id').references(() => cloudScheduledTasks.id).notNull(),
  status: text('status').notNull(), // 'success' | 'failure' | 'skipped'
  result: text('result'),
  error: text('error'),
  durationMs: integer('duration_ms'),
  executedAt: timestamp('executed_at').defaultNow().notNull(),
});
