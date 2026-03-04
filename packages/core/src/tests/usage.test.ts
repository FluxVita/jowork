// Tests for Phase 19: LLM cost management

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../datamap/migrator.js';
import { initSchema } from '../datamap/init.js';
import {
  recordUsage,
  queryUsageSummary,
  queryDailySpend,
  upsertBudgetConfig,
  getBudgetConfig,
  checkBudgetStatus,
  estimateCost,
  recommendModel,
} from '../datamap/usage.js';

async function freshDb(): Promise<Database.Database> {
  const db = new Database(':memory:');
  await migrate(db);
  initSchema(db); // ensures llm_usage + budget_config exist
  return db;
}

// ─── estimateCost ─────────────────────────────────────────────────────────────

describe('estimateCost', () => {
  test('returns 0 for unknown model', () => {
    assert.equal(estimateCost('unknown-model-xyz', 1000, 500), 0);
  });

  test('computes cost for claude-3-5-haiku-latest', () => {
    // $0.80/1M input + $4.00/1M output
    const cost = estimateCost('claude-3-5-haiku-latest', 1_000_000, 1_000_000);
    assert.ok(Math.abs(cost - 4.80) < 0.001);
  });

  test('local model (ollama) always costs 0', () => {
    assert.equal(estimateCost('llama3.2', 100_000, 50_000), 0);
  });
});

// ─── recommendModel ───────────────────────────────────────────────────────────

describe('recommendModel', () => {
  test('short input → simple complexity', () => {
    const rec = recommendModel('Hi there', 'anthropic');
    assert.equal(rec.complexity, 'simple');
    assert.ok(rec.recommendedModel.includes('haiku') || rec.recommendedModel.includes('mini'));
  });

  test('long input → complex complexity', () => {
    const longText = 'x'.repeat(3000);
    const rec = recommendModel(longText, 'anthropic');
    assert.equal(rec.complexity, 'complex');
  });

  test('medium input → moderate complexity', () => {
    const medText = 'x'.repeat(1000);
    const rec = recommendModel(medText, 'openai');
    assert.equal(rec.complexity, 'moderate');
    assert.ok(rec.recommendedModel.includes('gpt-4o'));
  });

  test('ollama provider recommendation', () => {
    const rec = recommendModel('hello', 'ollama');
    assert.equal(rec.complexity, 'simple');
    assert.ok(rec.recommendedModel.length > 0);
  });
});

// ─── recordUsage + queryUsageSummary ─────────────────────────────────────────

describe('recordUsage + queryUsageSummary', () => {
  test('recorded usage appears in monthly summary', async () => {
    const db = await freshDb();
    recordUsage(db, { userId: 'u1', model: 'claude-3-5-haiku-latest', provider: 'anthropic', inputTokens: 100, outputTokens: 50 });
    recordUsage(db, { userId: 'u1', model: 'claude-3-5-haiku-latest', provider: 'anthropic', inputTokens: 200, outputTokens: 100 });

    const now = new Date();
    const rows = queryUsageSummary(db, { userId: 'u1', year: now.getFullYear(), month: now.getMonth() + 1 });
    assert.ok(rows.length > 0, 'should have usage rows');
    const row = rows[0]!;
    assert.equal(row.totalInputTokens, 300);
    assert.equal(row.totalOutputTokens, 150);
    assert.equal(row.callCount, 2);
  });

  test('queryUsageSummary without userId returns all users', async () => {
    const db = await freshDb();
    recordUsage(db, { userId: 'u2', model: 'gpt-4o-mini', provider: 'openai', inputTokens: 500, outputTokens: 200 });
    recordUsage(db, { userId: 'u3', model: 'gpt-4o-mini', provider: 'openai', inputTokens: 300, outputTokens: 100 });

    const now = new Date();
    const rows = queryUsageSummary(db, { year: now.getFullYear(), month: now.getMonth() + 1 });
    const totalInputTokens = rows.reduce((s, r) => s + r.totalInputTokens, 0);
    assert.ok(totalInputTokens >= 800);
  });
});

// ─── queryDailySpend ─────────────────────────────────────────────────────────

describe('queryDailySpend', () => {
  test('returns daily rows for the month', async () => {
    const db = await freshDb();
    recordUsage(db, { userId: 'u4', model: 'gpt-4o', provider: 'openai', inputTokens: 1000, outputTokens: 500, costUsd: 0.005 });

    const now = new Date();
    const rows = queryDailySpend(db, 'u4', now.getFullYear(), now.getMonth() + 1);
    assert.ok(rows.length > 0);
    assert.ok(rows[0]!.costUsd >= 0);
  });
});

// ─── Budget config ────────────────────────────────────────────────────────────

describe('upsertBudgetConfig + getBudgetConfig', () => {
  test('upsert then get returns correct config', async () => {
    const db = await freshDb();
    upsertBudgetConfig(db, { userId: 'u5', monthlyLimitUsd: 50, warnPct: 0.8, alertPct: 1.0, blockPct: 1.2 });
    const cfg = getBudgetConfig(db, 'u5');
    assert.ok(cfg);
    assert.equal(cfg.monthlyLimitUsd, 50);
    assert.equal(cfg.warnPct, 0.8);
  });

  test('returns null for unconfigured user', async () => {
    const db = await freshDb();
    assert.equal(getBudgetConfig(db, 'nobody'), null);
  });

  test('upsert updates existing config', async () => {
    const db = await freshDb();
    upsertBudgetConfig(db, { userId: 'u6', monthlyLimitUsd: 10, warnPct: 0.8, alertPct: 1.0, blockPct: 1.2 });
    upsertBudgetConfig(db, { userId: 'u6', monthlyLimitUsd: 20, warnPct: 0.9, alertPct: 1.0, blockPct: 1.2 });
    const cfg = getBudgetConfig(db, 'u6');
    assert.equal(cfg?.monthlyLimitUsd, 20);
    assert.equal(cfg?.warnPct, 0.9);
  });
});

// ─── checkBudgetStatus ────────────────────────────────────────────────────────

describe('checkBudgetStatus', () => {
  test('returns null when no budget configured', async () => {
    const db = await freshDb();
    assert.equal(checkBudgetStatus(db, 'nobody'), null);
  });

  test('returns ok when under warn threshold', async () => {
    const db = await freshDb();
    upsertBudgetConfig(db, { userId: 'u7', monthlyLimitUsd: 100, warnPct: 0.8, alertPct: 1.0, blockPct: 1.2 });
    // No usage recorded → 0 spent
    const status = checkBudgetStatus(db, 'u7');
    assert.ok(status);
    assert.equal(status.alertLevel, 'ok');
    assert.equal(status.spentThisMonthUsd, 0);
  });

  test('returns warn when between 80-100% of limit', async () => {
    const db = await freshDb();
    upsertBudgetConfig(db, { userId: 'u8', monthlyLimitUsd: 1, warnPct: 0.8, alertPct: 1.0, blockPct: 1.2 });
    // Record $0.85 of usage
    recordUsage(db, { userId: 'u8', model: 'gpt-4o', provider: 'openai', inputTokens: 0, outputTokens: 0, costUsd: 0.85 });
    const status = checkBudgetStatus(db, 'u8');
    assert.ok(status);
    assert.equal(status.alertLevel, 'warn');
  });

  test('returns blocked when over block threshold', async () => {
    const db = await freshDb();
    upsertBudgetConfig(db, { userId: 'u9', monthlyLimitUsd: 1, warnPct: 0.8, alertPct: 1.0, blockPct: 1.2 });
    recordUsage(db, { userId: 'u9', model: 'gpt-4o', provider: 'openai', inputTokens: 0, outputTokens: 0, costUsd: 1.5 });
    const status = checkBudgetStatus(db, 'u9');
    assert.ok(status);
    assert.equal(status.alertLevel, 'blocked');
  });
});
