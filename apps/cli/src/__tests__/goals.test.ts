import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DbManager } from '../db/manager.js';
import { GoalManager } from '../goals/manager.js';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

describe('GoalManager', () => {
  let tempDir: string;
  let db: DbManager;
  let gm: GoalManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'jowork-goal-test-'));
    db = new DbManager(join(tempDir, 'test.db'));
    db.ensureTables();
    gm = new GoalManager(db.getSqlite());
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates a goal', () => {
    const goal = gm.createGoal({ title: 'Ship v1' });
    expect(goal.id).toMatch(/^goal_/);
    expect(goal.title).toBe('Ship v1');
    expect(goal.status).toBe('active');
    expect(goal.autonomyLevel).toBe('copilot');
  });

  it('lists goals by status', () => {
    gm.createGoal({ title: 'Active goal' });
    const g2 = gm.createGoal({ title: 'Paused goal' });
    gm.updateGoal(g2.id, { status: 'paused' });

    const active = gm.listGoals({ status: 'active' });
    expect(active.length).toBe(1);
    expect(active[0].title).toBe('Active goal');
  });

  it('creates signal and measure for a goal', () => {
    const goal = gm.createGoal({ title: 'DAU Growth' });
    const signal = gm.createSignal({
      goalId: goal.id, title: 'DAU', source: 'posthog', metric: 'dau', direction: 'maximize',
    });
    expect(signal.id).toMatch(/^sig_/);
    expect(signal.goalId).toBe(goal.id);

    const measure = gm.createMeasure({
      signalId: signal.id, threshold: 10000, comparison: 'gte',
    });
    expect(measure.id).toMatch(/^msr_/);
    expect(measure.met).toBe(false);
  });

  it('evaluates measure when signal value is updated', () => {
    const goal = gm.createGoal({ title: 'DAU Growth' });
    const signal = gm.createSignal({
      goalId: goal.id, title: 'DAU', source: 'posthog', metric: 'dau', direction: 'maximize',
    });
    gm.createMeasure({ signalId: signal.id, threshold: 100, comparison: 'gte' });

    // Below threshold
    gm.updateSignalValue(signal.id, 50);
    let measures = gm.getMeasuresForSignal(signal.id);
    expect(measures[0].met).toBe(false);
    expect(measures[0].current).toBe(50);

    // Above threshold
    gm.updateSignalValue(signal.id, 150);
    measures = gm.getMeasuresForSignal(signal.id);
    expect(measures[0].met).toBe(true);
    expect(measures[0].current).toBe(150);
  });

  it('supports between comparison', () => {
    const goal = gm.createGoal({ title: 'Maintain SLA' });
    const signal = gm.createSignal({
      goalId: goal.id, title: 'Uptime', source: 'monitor', metric: 'uptime_pct', direction: 'maintain',
    });
    gm.createMeasure({ signalId: signal.id, threshold: 99.5, comparison: 'between', upperBound: 100 });

    gm.updateSignalValue(signal.id, 99.8);
    const measures = gm.getMeasuresForSignal(signal.id);
    expect(measures[0].met).toBe(true);

    gm.updateSignalValue(signal.id, 98.0);
    const measures2 = gm.getMeasuresForSignal(signal.id);
    expect(measures2[0].met).toBe(false);
  });

  it('returns goal with signals and measures', () => {
    const goal = gm.createGoal({ title: 'Full stack' });
    const sig = gm.createSignal({ goalId: goal.id, title: 'S1', source: 'x', metric: 'y', direction: 'maximize' });
    gm.createMeasure({ signalId: sig.id, threshold: 10, comparison: 'gte' });

    const full = gm.getGoal(goal.id)!;
    expect(full.signals!.length).toBe(1);
    expect(full.signals![0].measures!.length).toBe(1);
  });
});
