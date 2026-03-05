import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
import { createLogger } from '../utils/logger.js';
import { runAlertChecks } from '../alerts/engine.js';
import { runDailyMaintenance } from '../resilience/index.js';

const log = createLogger('scheduler');

// ─── Cron 解析 ───

interface CronTask {
  task_id: string;
  name: string;
  cron_expr: string;
  action_type: 'message' | 'report' | 'sync' | 'custom';
  action_config: {
    template?: string;
    target_channel?: string;  // 'feishu_group:xxx' | 'telegram:xxx' | 'web'
    target_user_id?: string;
    connector_id?: string;
    query?: string;
  };
  created_by: string;
  approved: boolean;
  enabled: boolean;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
}

/** Cron 表达式字段匹配 */
function cronFieldMatches(field: string, value: number): boolean {
  if (field === '*') return true;

  // 逗号分隔的多个值
  if (field.includes(',')) {
    return field.split(',').some(f => cronFieldMatches(f.trim(), value));
  }

  // 范围 e.g. "1-5"
  if (field.includes('-')) {
    const [start, end] = field.split('-').map(Number);
    return value >= start && value <= end;
  }

  // 步进 e.g. "*/5"
  if (field.includes('/')) {
    const [base, step] = field.split('/');
    const stepNum = parseInt(step);
    if (base === '*') return value % stepNum === 0;
    return value >= parseInt(base) && (value - parseInt(base)) % stepNum === 0;
  }

  // 精确值
  return parseInt(field) === value;
}

/** 检查 Cron 表达式是否匹配当前时间 */
export function cronMatches(expr: string, date = new Date()): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  return (
    cronFieldMatches(minute, date.getMinutes()) &&
    cronFieldMatches(hour, date.getHours()) &&
    cronFieldMatches(dayOfMonth, date.getDate()) &&
    cronFieldMatches(month, date.getMonth() + 1) &&
    cronFieldMatches(dayOfWeek, date.getDay())
  );
}

/** 计算下一次运行时间 */
function nextRunTime(cronExpr: string): string {
  const now = new Date();
  // 从当前分钟开始，向前搜索最多 24 小时
  for (let i = 1; i <= 1440; i++) {
    const candidate = new Date(now.getTime() + i * 60_000);
    candidate.setSeconds(0, 0);
    if (cronMatches(cronExpr, candidate)) {
      return candidate.toISOString();
    }
  }
  return new Date(now.getTime() + 86400_000).toISOString(); // 兜底 24h 后
}

// ─── CRUD ───

export function createCronTask(task: Omit<CronTask, 'task_id' | 'created_at' | 'last_run_at' | 'next_run_at'>): string {
  const db = getDb();
  const taskId = genId('cron');
  const now = new Date().toISOString();
  const nextRun = task.enabled ? nextRunTime(task.cron_expr) : null;

  db.prepare(`
    INSERT INTO cron_tasks (task_id, name, cron_expr, action_type, action_config_json,
      created_by, approved, enabled, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, task.name, task.cron_expr, task.action_type,
    JSON.stringify(task.action_config), task.created_by,
    task.approved ? 1 : 0, task.enabled ? 1 : 0, nextRun);

  log.info(`Cron task created: ${task.name} (${task.cron_expr})`);
  return taskId;
}

export function listCronTasks(): CronTask[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM cron_tasks ORDER BY created_at DESC').all() as Record<string, unknown>[];
  return rows.map(rowToCronTask);
}

export function getCronTask(taskId: string): CronTask | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM cron_tasks WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;
  return row ? rowToCronTask(row) : null;
}

export function updateCronTask(taskId: string, updates: Partial<Pick<CronTask, 'name' | 'cron_expr' | 'approved' | 'enabled'>>) {
  const db = getDb();
  const sets: string[] = [];
  const params: unknown[] = [];

  if (updates.name !== undefined) { sets.push('name = ?'); params.push(updates.name); }
  if (updates.cron_expr !== undefined) {
    sets.push('cron_expr = ?'); params.push(updates.cron_expr);
    sets.push('next_run_at = ?'); params.push(nextRunTime(updates.cron_expr));
  }
  if (updates.approved !== undefined) { sets.push('approved = ?'); params.push(updates.approved ? 1 : 0); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }

  if (sets.length === 0) return;

  params.push(taskId);
  db.prepare(`UPDATE cron_tasks SET ${sets.join(', ')} WHERE task_id = ?`).run(...params);
}

export function deleteCronTask(taskId: string) {
  const db = getDb();
  db.prepare('DELETE FROM cron_tasks WHERE task_id = ?').run(taskId);
}

function rowToCronTask(row: Record<string, unknown>): CronTask {
  return {
    task_id: row['task_id'] as string,
    name: row['name'] as string,
    cron_expr: row['cron_expr'] as string,
    action_type: row['action_type'] as CronTask['action_type'],
    action_config: JSON.parse(row['action_config_json'] as string),
    created_by: row['created_by'] as string,
    approved: row['approved'] === 1,
    enabled: row['enabled'] === 1,
    last_run_at: row['last_run_at'] as string | null,
    next_run_at: row['next_run_at'] as string | null,
    created_at: row['created_at'] as string,
  };
}

// ─── 调度引擎 ───

type TaskExecutor = (task: CronTask) => Promise<void>;
let executor: TaskExecutor | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

/** 注册任务执行器 */
export function setTaskExecutor(fn: TaskExecutor) {
  executor = fn;
}

/** 启动调度器（每分钟检查一次） */
export function startScheduler() {
  if (tickInterval) return;

  tickInterval = setInterval(() => {
    tick().catch(err => log.error('Scheduler tick failed', err));
  }, 60_000);

  log.info('Scheduler started (1min interval)');
}

/** 停止调度器 */
export function stopScheduler() {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

/** 单次调度检查 */
async function tick() {
  const db = getDb();
  const now = new Date();

  // 查找需要执行的任务
  const tasks = db.prepare(`
    SELECT * FROM cron_tasks
    WHERE enabled = 1 AND approved = 1
  `).all() as Record<string, unknown>[];

  for (const row of tasks) {
    const task = rowToCronTask(row);

    if (!cronMatches(task.cron_expr, now)) continue;

    // 防止同一分钟重复执行
    if (task.last_run_at) {
      const lastRun = new Date(task.last_run_at);
      if (now.getTime() - lastRun.getTime() < 55_000) continue;
    }

    log.info(`Executing cron task: ${task.name}`);

    try {
      if (executor) {
        await executor(task);
      } else {
        log.warn(`No executor registered, skipping task: ${task.name}`);
      }

      // 更新执行时间
      db.prepare(`
        UPDATE cron_tasks SET last_run_at = ?, next_run_at = ? WHERE task_id = ?
      `).run(now.toISOString(), nextRunTime(task.cron_expr), task.task_id);

    } catch (err) {
      log.error(`Cron task failed: ${task.name}`, err);
    }
  }

  // 告警检查（每次 tick 都运行，引擎内部做频率控制和去重）
  try {
    await runAlertChecks();
  } catch (err) {
    log.error('Alert checks failed', err);
  }

  // 每天凌晨 3 点运行维护任务（备份、清理）
  if (now.getHours() === 3 && now.getMinutes() === 0) {
    try {
      runDailyMaintenance();
    } catch (err) {
      log.error('Daily maintenance failed', err);
    }
  }
}
