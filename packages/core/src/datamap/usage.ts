// @jowork/core/datamap/usage — LLM usage tracking + budget management
//
// Tracks every LLM call with token counts and estimated cost.
// Provides budget configuration (per user or global) with 3-level alerts:
//   80% → warn, 100% → alert, 120% → block (configurable)
//
// Tables:
//   llm_usage      — per-call token log
//   budget_config  — per-user or global budget rules

import type Database from 'better-sqlite3';
import { logger } from '../utils/index.js';

// ─── Bootstrap (called by init.ts / initSchema) ───────────────────────────────

export const USAGE_SCHEMA = `
CREATE TABLE IF NOT EXISTS llm_usage (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL DEFAULT 'system',
  model       TEXT NOT NULL,
  provider    TEXT NOT NULL DEFAULT 'unknown',
  usage_type  TEXT NOT NULL DEFAULT 'chat',
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd    REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_usage_user_date ON llm_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_llm_usage_created ON llm_usage(created_at);

CREATE TABLE IF NOT EXISTS budget_config (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     TEXT NOT NULL DEFAULT 'global',
  monthly_limit_usd REAL NOT NULL DEFAULT 0,
  warn_pct    REAL NOT NULL DEFAULT 0.8,
  alert_pct   REAL NOT NULL DEFAULT 1.0,
  block_pct   REAL NOT NULL DEFAULT 1.2,
  updated_at  TEXT NOT NULL,
  UNIQUE(user_id)
);
`;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UsageRecord {
  userId?: string;
  model: string;
  provider?: string;
  usageType?: string;
  inputTokens: number;
  outputTokens: number;
  /** Cost in USD — pass 0 if unknown, will be computed from model info if available */
  costUsd?: number;
}

export interface UsageSummary {
  userId: string;
  model: string;
  provider: string;
  usageType: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  callCount: number;
}

export interface BudgetConfig {
  userId: string;
  monthlyLimitUsd: number;
  warnPct: number;
  alertPct: number;
  blockPct: number;
}

export type BudgetAlertLevel = 'ok' | 'warn' | 'alert' | 'blocked';

export interface BudgetStatus {
  userId: string;
  monthlyLimitUsd: number;
  spentThisMonthUsd: number;
  usagePct: number;
  alertLevel: BudgetAlertLevel;
}

// ─── Model cost table (USD per 1M tokens) ─────────────────────────────────────

const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-6':           { input: 15.00, output: 75.00 },
  'claude-sonnet-4-6':         { input:  3.00, output: 15.00 },
  'claude-3-5-sonnet-latest':  { input:  3.00, output: 15.00 },
  'claude-3-5-haiku-latest':   { input:  0.80, output:  4.00 },
  // OpenAI
  'gpt-4o':                    { input:  2.50, output: 10.00 },
  'gpt-4o-mini':               { input:  0.15, output:  0.60 },
  'gpt-4.1':                   { input:  2.00, output:  8.00 },
  // Ollama (local, free)
  'llama3.2':                  { input: 0, output: 0 },
  'qwen2.5':                   { input: 0, output: 0 },
  'mistral':                   { input: 0, output: 0 },
};

export function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const rates = MODEL_COSTS[model];
  if (!rates) return 0;
  return (inputTokens * rates.input + outputTokens * rates.output) / 1_000_000;
}

// ─── Write ────────────────────────────────────────────────────────────────────

export function recordUsage(db: Database.Database, rec: UsageRecord): void {
  const cost = rec.costUsd ?? estimateCost(rec.model, rec.inputTokens, rec.outputTokens);
  try {
    db.prepare(`
      INSERT INTO llm_usage (user_id, model, provider, usage_type, input_tokens, output_tokens, cost_usd, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      rec.userId ?? 'system',
      rec.model,
      rec.provider ?? 'unknown',
      rec.usageType ?? 'chat',
      rec.inputTokens,
      rec.outputTokens,
      cost,
      new Date().toISOString(),
    );
  } catch (err) {
    // Never crash the caller on a logging failure
    logger.warn('Failed to record LLM usage', { err: String(err) });
  }
}

// ─── Read — dashboard queries ─────────────────────────────────────────────────

/** Monthly usage summary grouped by user + model. */
export function queryUsageSummary(
  db: Database.Database,
  opts: {
    userId?: string;
    year: number;
    month: number; // 1-based
  },
): UsageSummary[] {
  const start = new Date(opts.year, opts.month - 1, 1).toISOString();
  const end   = new Date(opts.year, opts.month,     1).toISOString();

  const where = opts.userId ? 'AND user_id = ?' : '';
  const params: (string | number)[] = [start, end];
  if (opts.userId) params.push(opts.userId);

  return db.prepare(`
    SELECT
      user_id AS userId,
      model,
      provider,
      usage_type AS usageType,
      SUM(input_tokens) AS totalInputTokens,
      SUM(output_tokens) AS totalOutputTokens,
      SUM(cost_usd) AS totalCostUsd,
      COUNT(*) AS callCount
    FROM llm_usage
    WHERE created_at >= ? AND created_at < ? ${where}
    GROUP BY user_id, model, provider, usage_type
    ORDER BY totalCostUsd DESC
  `).all(...params) as UsageSummary[];
}

/** Daily spending for a given user in the current month (for chart data). */
export function queryDailySpend(
  db: Database.Database,
  userId: string,
  year: number,
  month: number,
): Array<{ date: string; costUsd: number }> {
  const start = new Date(year, month - 1, 1).toISOString();
  const end   = new Date(year, month,     1).toISOString();

  return db.prepare(`
    SELECT
      substr(created_at, 1, 10) AS date,
      SUM(cost_usd) AS costUsd
    FROM llm_usage
    WHERE user_id = ? AND created_at >= ? AND created_at < ?
    GROUP BY date
    ORDER BY date
  `).all(userId, start, end) as Array<{ date: string; costUsd: number }>;
}

// ─── Budget config ────────────────────────────────────────────────────────────

export function upsertBudgetConfig(db: Database.Database, cfg: BudgetConfig): void {
  db.prepare(`
    INSERT INTO budget_config (user_id, monthly_limit_usd, warn_pct, alert_pct, block_pct, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      monthly_limit_usd = excluded.monthly_limit_usd,
      warn_pct = excluded.warn_pct,
      alert_pct = excluded.alert_pct,
      block_pct = excluded.block_pct,
      updated_at = excluded.updated_at
  `).run(
    cfg.userId,
    cfg.monthlyLimitUsd,
    cfg.warnPct,
    cfg.alertPct,
    cfg.blockPct,
    new Date().toISOString(),
  );
}

export function getBudgetConfig(db: Database.Database, userId: string): BudgetConfig | null {
  const row = db.prepare(`SELECT * FROM budget_config WHERE user_id = ?`).get(userId) as
    | { user_id: string; monthly_limit_usd: number; warn_pct: number; alert_pct: number; block_pct: number }
    | undefined;
  if (!row) return null;
  return {
    userId: row.user_id,
    monthlyLimitUsd: row.monthly_limit_usd,
    warnPct: row.warn_pct,
    alertPct: row.alert_pct,
    blockPct: row.block_pct,
  };
}

/** Check current budget status for a user (month = current calendar month). */
export function checkBudgetStatus(db: Database.Database, userId: string): BudgetStatus | null {
  const cfg = getBudgetConfig(db, userId) ?? getBudgetConfig(db, 'global');
  if (!cfg || cfg.monthlyLimitUsd <= 0) return null;

  const now = new Date();
  const rows = queryUsageSummary(db, { userId, year: now.getFullYear(), month: now.getMonth() + 1 });
  const spent = rows.reduce((s, r) => s + r.totalCostUsd, 0);
  const usagePct = spent / cfg.monthlyLimitUsd;

  let alertLevel: BudgetAlertLevel = 'ok';
  if (usagePct >= cfg.blockPct) alertLevel = 'blocked';
  else if (usagePct >= cfg.alertPct) alertLevel = 'alert';
  else if (usagePct >= cfg.warnPct) alertLevel = 'warn';

  return {
    userId,
    monthlyLimitUsd: cfg.monthlyLimitUsd,
    spentThisMonthUsd: spent,
    usagePct,
    alertLevel,
  };
}

// ─── Intelligent model recommendation ─────────────────────────────────────────

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

/**
 * Recommend a model tier based on estimated task complexity.
 *
 * Complexity is estimated from total input length:
 *   <500 chars  → simple  (fast, cheap model)
 *   <2000 chars → moderate
 *   ≥2000 chars → complex (capable model)
 */
export function recommendModel(
  inputText: string,
  currentProvider: string,
): { complexity: TaskComplexity; recommendedModel: string; reason: string } {
  const len = inputText.length;

  if (len < 500) {
    const model = currentProvider === 'anthropic' ? 'claude-3-5-haiku-latest'
      : currentProvider === 'openai' ? 'gpt-4o-mini'
      : 'llama3.2';
    return { complexity: 'simple', recommendedModel: model, reason: 'Short input — fast model sufficient' };
  }

  if (len < 2000) {
    const model = currentProvider === 'anthropic' ? 'claude-3-5-sonnet-latest'
      : currentProvider === 'openai' ? 'gpt-4o'
      : 'qwen2.5';
    return { complexity: 'moderate', recommendedModel: model, reason: 'Medium input — balanced model recommended' };
  }

  const model = currentProvider === 'anthropic' ? 'claude-sonnet-4-6'
    : currentProvider === 'openai' ? 'gpt-4.1'
    : 'llama3.2';
  return { complexity: 'complex', recommendedModel: model, reason: 'Long/complex input — capable model recommended' };
}
