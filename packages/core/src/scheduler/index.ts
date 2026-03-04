// @jowork/core/scheduler — cron-based task scheduler (no external dep)
// Uses node:timers for periodic polling. Cron expressions parsed minimally.

import type { SchedulerTask } from '../types.js';
import { getDb } from '../datamap/db.js';
import { generateId, nowISO, logger } from '../utils/index.js';

/** Parse a simple cron expression: "min hour dom month dow" */
function matchesCron(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [min, hour, dom, month, dow] = parts as [string, string, string, string, string];
  const check = (part: string, value: number): boolean => {
    if (part === '*') return true;
    if (part.includes('/')) {
      const [, step] = part.split('/');
      return value % parseInt(step ?? '1', 10) === 0;
    }
    return parseInt(part, 10) === value;
  };
  return (
    check(min, date.getMinutes()) &&
    check(hour, date.getHours()) &&
    check(dom, date.getDate()) &&
    check(month, date.getMonth() + 1) &&
    check(dow, date.getDay())
  );
}

export type TaskRunner = (task: SchedulerTask) => Promise<void>;

let _timer: ReturnType<typeof setInterval> | null = null;
let _runner: TaskRunner | null = null;

/** Start the scheduler. Polls every 60 seconds. */
export function startScheduler(runner: TaskRunner): void {
  if (_timer) return;
  _runner = runner;
  _timer = setInterval(() => void tick(), 60_000);
  logger.info('Scheduler started');
}

export function stopScheduler(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    _runner = null;
    logger.info('Scheduler stopped');
  }
}

async function tick(): Promise<void> {
  if (!_runner) return;
  const db = getDb();
  const now = new Date();
  const tasks = db.prepare(
    `SELECT * FROM scheduler_tasks WHERE enabled = 1`,
  ).all() as RawTaskRow[];

  for (const row of tasks) {
    if (!matchesCron(row.cron_expr, now)) continue;
    const task = fromRow(row);
    try {
      await _runner(task);
      db.prepare(`UPDATE scheduler_tasks SET last_run_at = ? WHERE id = ?`).run(nowISO(), task.id);
      logger.info('Scheduler task ran', { id: task.id, name: task.name });
    } catch (err) {
      logger.error('Scheduler task failed', { id: task.id, err: String(err) });
    }
  }
}

export function createTask(
  data: Omit<SchedulerTask, 'id' | 'createdAt' | 'lastRunAt' | 'nextRunAt'>,
): SchedulerTask {
  const db = getDb();
  const task: SchedulerTask = {
    ...data,
    id: generateId(),
    lastRunAt: null,
    nextRunAt: null,
    createdAt: nowISO(),
  };
  db.prepare(`
    INSERT INTO scheduler_tasks (id, agent_id, user_id, name, cron_expr, action, params, enabled, last_run_at, next_run_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.id, task.agentId, task.userId, task.name,
    task.cronExpr, task.action, JSON.stringify(task.params),
    task.enabled ? 1 : 0, null, null, task.createdAt,
  );
  return task;
}

export function listTasks(userId: string): SchedulerTask[] {
  const db = getDb();
  return (db.prepare(`SELECT * FROM scheduler_tasks WHERE user_id = ? ORDER BY created_at DESC`).all(userId) as RawTaskRow[]).map(fromRow);
}

export function toggleTask(id: string, enabled: boolean): void {
  getDb().prepare(`UPDATE scheduler_tasks SET enabled = ? WHERE id = ?`).run(enabled ? 1 : 0, id);
}

export function deleteTask(id: string): void {
  getDb().prepare(`DELETE FROM scheduler_tasks WHERE id = ?`).run(id);
}

// ─── Internal ────────────────────────────────────────────────────────────────

interface RawTaskRow {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  cron_expr: string;
  action: string;
  params: string;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

function fromRow(row: RawTaskRow): SchedulerTask {
  return {
    id: row.id,
    agentId: row.agent_id,
    userId: row.user_id,
    name: row.name,
    cronExpr: row.cron_expr,
    action: row.action,
    params: JSON.parse(row.params) as Record<string, unknown>,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
  };
}
