import { pgTable, text, timestamp, integer, boolean, jsonb, primaryKey } from 'drizzle-orm/pg-core';

// --- Users ---
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  plan: text('plan').notNull().default('free'),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// --- Teams ---
export const teams = pgTable('teams', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  ownerId: text('owner_id').references(() => users.id).notNull(),
  plan: text('plan').notNull().default('team'),
  inviteCode: text('invite_code').unique(),
  stripeCustomerId: text('stripe_customer_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// --- Team Members ---
export const teamMembers = pgTable('team_members', {
  teamId: text('team_id').references(() => teams.id).notNull(),
  userId: text('user_id').references(() => users.id).notNull(),
  role: text('role').notNull().default('member'), // 'owner' | 'admin' | 'member'
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.teamId, t.userId] })]);

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

// --- Phase 6: Auth + Billing + Team ---

// Credits tracking
export const credits = pgTable('credits', {
  id: text('id').primaryKey(),
  userId: text('user_id').references(() => users.id).notNull(),
  teamId: text('team_id').references(() => teams.id),
  used: integer('used').default(0),
  monthlyLimit: integer('monthly_limit'),
  walletBalance: integer('wallet_balance').default(0),
  dailyFreeLimit: integer('daily_free_limit').default(50),
  dailyFreeUsed: integer('daily_free_used').default(0),
  dailyFreeResetAt: timestamp('daily_free_reset_at'),
  periodStart: timestamp('period_start'),
  periodEnd: timestamp('period_end'),
});

// Cloud sessions (Team mode)
export const cloudSessions = pgTable('cloud_sessions', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id),
  userId: text('user_id').references(() => users.id).notNull(),
  title: text('title'),
  engineId: text('engine_id'),
  messageCount: integer('message_count').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Cloud messages
export const cloudMessages = pgTable('cloud_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => cloudSessions.id).notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  toolName: text('tool_name'),
  tokens: integer('tokens'),
  cost: integer('cost'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Cloud memories (Team scope)
export const cloudMemories = pgTable('cloud_memories', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id),
  title: text('title').notNull(),
  content: text('content').notNull(),
  tags: jsonb('tags'),
  scope: text('scope').notNull().default('team'),
  pinned: boolean('pinned').default(false),
  source: text('source'),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// User preferences (JSON KV store per user)
export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').references(() => users.id).primaryKey(),
  data: jsonb('data').notNull().default({}),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Cloud context docs (Team scope)
export const cloudContextDocs = pgTable('cloud_context_docs', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id),
  title: text('title').notNull(),
  content: text('content').notNull(),
  scope: text('scope').notNull().default('team'),
  category: text('category'),
  priority: integer('priority').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
