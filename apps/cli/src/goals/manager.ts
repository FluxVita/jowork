import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { logInfo } from '../utils/logger.js';

export interface Goal {
  id: string;
  title: string;
  description: string | null;
  status: 'active' | 'paused' | 'completed' | 'evolved';
  autonomyLevel: 'copilot' | 'semipilot' | 'autopilot';
  parentId: string | null;
  evolvedFrom: string | null;
  createdAt: number;
  updatedAt: number;
  signals?: Signal[];
}

export interface Signal {
  id: string;
  goalId: string;
  title: string;
  source: string;
  metric: string;
  direction: 'maximize' | 'minimize' | 'maintain';
  pollInterval: number;
  config: Record<string, unknown> | null;
  currentValue: number | null;
  lastPolledAt: number | null;
  createdAt: number;
  updatedAt: number;
  measures?: Measure[];
}

export interface Measure {
  id: string;
  signalId: string;
  threshold: number;
  comparison: 'gte' | 'lte' | 'gt' | 'lt' | 'eq' | 'between';
  upperBound: number | null;
  current: number | null;
  met: boolean;
  lastEvaluatedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export class GoalManager {
  constructor(private sqlite: Database.Database) {}

  // ── Goals ──

  createGoal(opts: { title: string; description?: string; parentId?: string; autonomyLevel?: string; evolvedFrom?: string }): Goal {
    const now = Date.now();
    const id = createId('goal');
    this.sqlite.prepare(`
      INSERT INTO goals (id, title, description, status, autonomy_level, parent_id, evolved_from, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?)
    `).run(id, opts.title, opts.description ?? null, opts.autonomyLevel ?? 'copilot', opts.parentId ?? null, opts.evolvedFrom ?? null, now, now);
    logInfo('goals', `Goal created: "${opts.title}"`, { id });
    return this.getGoal(id)!;
  }

  getGoal(id: string): Goal | null {
    const row = this.sqlite.prepare('SELECT * FROM goals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const goal = this.rowToGoal(row);
    goal.signals = this.getSignalsForGoal(id);
    return goal;
  }

  listGoals(opts: { status?: string } = {}): Goal[] {
    let query = 'SELECT * FROM goals';
    const args: unknown[] = [];
    if (opts.status) { query += ' WHERE status = ?'; args.push(opts.status); }
    query += ' ORDER BY created_at DESC';
    const rows = this.sqlite.prepare(query).all(...args) as Record<string, unknown>[];
    return rows.map(r => {
      const goal = this.rowToGoal(r);
      goal.signals = this.getSignalsForGoal(goal.id);
      return goal;
    });
  }

  updateGoal(id: string, patch: Partial<Pick<Goal, 'title' | 'description' | 'status' | 'autonomyLevel'>>): Goal | null {
    const now = Date.now();
    const sets: string[] = ['updated_at = ?'];
    const args: unknown[] = [now];
    if (patch.title !== undefined) { sets.push('title = ?'); args.push(patch.title); }
    if (patch.description !== undefined) { sets.push('description = ?'); args.push(patch.description); }
    if (patch.status !== undefined) { sets.push('status = ?'); args.push(patch.status); }
    if (patch.autonomyLevel !== undefined) { sets.push('autonomy_level = ?'); args.push(patch.autonomyLevel); }
    args.push(id);
    this.sqlite.prepare(`UPDATE goals SET ${sets.join(', ')} WHERE id = ?`).run(...args);
    return this.getGoal(id);
  }

  // ── Signals ──

  createSignal(opts: { goalId: string; title: string; source: string; metric: string; direction: string; pollInterval?: number; config?: Record<string, unknown> }): Signal {
    const now = Date.now();
    const id = createId('sig');
    this.sqlite.prepare(`
      INSERT INTO signals (id, goal_id, title, source, metric, direction, poll_interval, config, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, opts.goalId, opts.title, opts.source, opts.metric, opts.direction, opts.pollInterval ?? 3600, opts.config ? JSON.stringify(opts.config) : null, now, now);
    logInfo('goals', `Signal created: "${opts.title}" for goal ${opts.goalId}`, { id });
    return this.getSignal(id)!;
  }

  getSignal(id: string): Signal | null {
    const row = this.sqlite.prepare('SELECT * FROM signals WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const signal = this.rowToSignal(row);
    signal.measures = this.getMeasuresForSignal(id);
    return signal;
  }

  getSignalsForGoal(goalId: string): Signal[] {
    const rows = this.sqlite.prepare('SELECT * FROM signals WHERE goal_id = ? ORDER BY created_at').all(goalId) as Record<string, unknown>[];
    return rows.map(r => {
      const sig = this.rowToSignal(r);
      sig.measures = this.getMeasuresForSignal(sig.id);
      return sig;
    });
  }

  updateSignalValue(id: string, value: number): void {
    const now = Date.now();
    this.sqlite.prepare('UPDATE signals SET current_value = ?, last_polled_at = ?, updated_at = ? WHERE id = ?').run(value, now, now, id);
    // Evaluate measures
    const measures = this.getMeasuresForSignal(id);
    for (const m of measures) {
      const met = this.evaluateMeasure(m, value);
      this.sqlite.prepare('UPDATE measures SET current = ?, met = ?, last_evaluated_at = ?, updated_at = ? WHERE id = ?')
        .run(value, met ? 1 : 0, now, now, m.id);
    }
  }

  // ── Measures ──

  createMeasure(opts: { signalId: string; threshold: number; comparison: string; upperBound?: number }): Measure {
    const now = Date.now();
    const id = createId('msr');
    this.sqlite.prepare(`
      INSERT INTO measures (id, signal_id, threshold, comparison, upper_bound, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, opts.signalId, opts.threshold, opts.comparison, opts.upperBound ?? null, now, now);
    return this.getMeasure(id)!;
  }

  getMeasure(id: string): Measure | null {
    const row = this.sqlite.prepare('SELECT * FROM measures WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    return row ? this.rowToMeasure(row) : null;
  }

  getMeasuresForSignal(signalId: string): Measure[] {
    const rows = this.sqlite.prepare('SELECT * FROM measures WHERE signal_id = ? ORDER BY created_at').all(signalId) as Record<string, unknown>[];
    return rows.map(r => this.rowToMeasure(r));
  }

  // ── Helpers ──

  private evaluateMeasure(measure: Measure, value: number): boolean {
    switch (measure.comparison) {
      case 'gte': return value >= measure.threshold;
      case 'lte': return value <= measure.threshold;
      case 'gt': return value > measure.threshold;
      case 'lt': return value < measure.threshold;
      case 'eq': return value === measure.threshold;
      case 'between': return value >= measure.threshold && value <= (measure.upperBound ?? Infinity);
      default: return false;
    }
  }

  private rowToGoal(row: Record<string, unknown>): Goal {
    return {
      id: row.id as string,
      title: row.title as string,
      description: row.description as string | null,
      status: row.status as Goal['status'],
      autonomyLevel: row.autonomy_level as Goal['autonomyLevel'],
      parentId: row.parent_id as string | null,
      evolvedFrom: row.evolved_from as string | null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private rowToSignal(row: Record<string, unknown>): Signal {
    return {
      id: row.id as string,
      goalId: row.goal_id as string,
      title: row.title as string,
      source: row.source as string,
      metric: row.metric as string,
      direction: row.direction as Signal['direction'],
      pollInterval: row.poll_interval as number,
      config: row.config ? JSON.parse(row.config as string) : null,
      currentValue: row.current_value as number | null,
      lastPolledAt: row.last_polled_at as number | null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  private rowToMeasure(row: Record<string, unknown>): Measure {
    return {
      id: row.id as string,
      signalId: row.signal_id as string,
      threshold: row.threshold as number,
      comparison: row.comparison as Measure['comparison'],
      upperBound: row.upper_bound as number | null,
      current: row.current as number | null,
      met: row.met === 1,
      lastEvaluatedAt: row.last_evaluated_at as number | null,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }
}
