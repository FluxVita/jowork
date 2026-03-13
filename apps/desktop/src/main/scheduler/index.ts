import { Cron } from 'croner';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq, desc } from 'drizzle-orm';
import { scheduledTasks, taskExecutions } from '@jowork/core';
import { createId } from '@jowork/core';
import type { EngineManager } from '../engine/manager';
import type { Scanner } from './scanner';

export type TaskType = 'scan' | 'skill' | 'notify';

export interface ScheduledTaskRecord {
  id: string;
  name: string;
  cronExpression: string;
  timezone: string;
  type: TaskType;
  config: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: number | null;
  nextRunAt: number | null;
  cloudSync: boolean;
  createdAt: number;
}

export interface NewScheduledTask {
  name: string;
  cronExpression: string;
  timezone?: string;
  type: TaskType;
  config?: Record<string, unknown>;
  enabled?: boolean;
  cloudSync?: boolean;
}

export class Scheduler {
  private jobs = new Map<string, Cron>();
  private db: BetterSQLite3Database;
  private sqlite: Database.Database;
  private engineManager: EngineManager | null = null;
  private scanner: Scanner | null = null;

  constructor(sqlite: Database.Database) {
    this.sqlite = sqlite;
    this.db = drizzle(sqlite);
    this.ensureTable();
  }

  setEngineManager(em: EngineManager): void {
    this.engineManager = em;
  }

  setScanner(scanner: Scanner): void {
    this.scanner = scanner;
  }

  private ensureTable(): void {
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        timezone TEXT DEFAULT 'Asia/Shanghai',
        type TEXT NOT NULL,
        config TEXT,
        enabled INTEGER DEFAULT 1,
        last_run_at INTEGER,
        next_run_at INTEGER,
        cloud_sync INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_executions (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES scheduled_tasks(id),
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        duration_ms INTEGER,
        executed_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_task_executions_task ON task_executions(task_id, executed_at);
    `);
  }

  create(task: NewScheduledTask): ScheduledTaskRecord {
    const id = createId('task');
    const now = Date.now();
    const row = {
      id,
      name: task.name,
      cronExpression: task.cronExpression,
      timezone: task.timezone ?? 'Asia/Shanghai',
      type: task.type,
      config: JSON.stringify(task.config ?? {}),
      enabled: (task.enabled ?? true) ? 1 : 0,
      lastRunAt: null,
      nextRunAt: null,
      cloudSync: (task.cloudSync ?? false) ? 1 : 0,
      createdAt: now,
    };

    this.db.insert(scheduledTasks).values(row).run();
    const record = this.toRecord(row);

    if (record.enabled) {
      this.startJob(record);
    }

    return record;
  }

  update(id: string, patch: Partial<NewScheduledTask>): ScheduledTaskRecord | null {
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.cronExpression !== undefined) updates.cronExpression = patch.cronExpression;
    if (patch.timezone !== undefined) updates.timezone = patch.timezone;
    if (patch.type !== undefined) updates.type = patch.type;
    if (patch.config !== undefined) updates.config = JSON.stringify(patch.config);
    if (patch.enabled !== undefined) updates.enabled = patch.enabled ? 1 : 0;
    if (patch.cloudSync !== undefined) updates.cloudSync = patch.cloudSync ? 1 : 0;

    this.db.update(scheduledTasks).set(updates).where(eq(scheduledTasks.id, id)).run();

    // Restart job if schedule or enabled changed
    this.stopJob(id);
    const row = this.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get();
    if (!row) return null;

    const record = this.toRecord(row);
    if (record.enabled) {
      this.startJob(record);
    }
    return record;
  }

  delete(id: string): void {
    this.stopJob(id);
    this.sqlite.prepare('DELETE FROM task_executions WHERE task_id = ?').run(id);
    this.db.delete(scheduledTasks).where(eq(scheduledTasks.id, id)).run();
  }

  list(): ScheduledTaskRecord[] {
    const rows = this.db.select().from(scheduledTasks).orderBy(desc(scheduledTasks.createdAt)).all();
    return rows.map((r) => this.toRecord(r));
  }

  get(id: string): ScheduledTaskRecord | null {
    const row = this.db.select().from(scheduledTasks).where(eq(scheduledTasks.id, id)).get();
    return row ? this.toRecord(row) : null;
  }

  getExecutions(taskId: string, limit = 20): Array<{
    id: string;
    status: string;
    result: string | null;
    error: string | null;
    durationMs: number | null;
    executedAt: number;
  }> {
    return this.db.select().from(taskExecutions)
      .where(eq(taskExecutions.taskId, taskId))
      .orderBy(desc(taskExecutions.executedAt))
      .limit(limit)
      .all();
  }

  /** Start all enabled jobs (call on app startup) */
  startAll(): void {
    const enabled = this.db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.enabled, 1))
      .all();

    for (const row of enabled) {
      this.startJob(this.toRecord(row));
    }
  }

  /** Stop all running jobs (call on app quit) */
  stopAll(): void {
    for (const [id, job] of this.jobs) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  /** Track running tasks to prevent concurrent execution of same job. */
  private running = new Set<string>();

  private startJob(task: ScheduledTaskRecord): void {
    if (this.jobs.has(task.id)) return;

    const job = new Cron(task.cronExpression, {
      timezone: task.timezone,
    }, async () => {
      if (this.running.has(task.id)) return; // skip if previous run still active
      this.running.add(task.id);
      try {
        await this.execute(task);
      } finally {
        this.running.delete(task.id);
      }
    });

    this.jobs.set(task.id, job);

    // Update nextRunAt
    const nextRun = job.nextRun();
    if (nextRun) {
      this.db.update(scheduledTasks)
        .set({ nextRunAt: nextRun.getTime() })
        .where(eq(scheduledTasks.id, task.id))
        .run();
    }
  }

  private stopJob(id: string): void {
    const job = this.jobs.get(id);
    if (job) {
      job.stop();
      this.jobs.delete(id);
    }
  }

  private async execute(task: ScheduledTaskRecord): Promise<void> {
    const startTime = Date.now();
    let status = 'success';
    let result: string | null = null;
    let error: string | null = null;

    try {
      switch (task.type) {
        case 'scan':
          result = await this.executeScan(task);
          break;
        case 'skill':
          result = await this.executeSkill(task);
          break;
        case 'notify':
          result = await this.executeNotify(task);
          break;
        default:
          status = 'skipped';
          result = `Unknown task type: ${task.type}`;
      }
    } catch (err) {
      status = 'failure';
      error = String(err);
    }

    const durationMs = Date.now() - startTime;

    // Log execution
    this.db.insert(taskExecutions).values({
      id: createId('exec'),
      taskId: task.id,
      status,
      result,
      error,
      durationMs,
      executedAt: Date.now(),
    }).run();

    // Update lastRunAt and nextRunAt
    const job = this.jobs.get(task.id);
    const nextRun = job?.nextRun();
    this.db.update(scheduledTasks).set({
      lastRunAt: Date.now(),
      nextRunAt: nextRun ? nextRun.getTime() : null,
    }).where(eq(scheduledTasks.id, task.id)).run();
  }

  private async executeScan(task: ScheduledTaskRecord): Promise<string> {
    if (!this.scanner) {
      return 'Scanner not initialized';
    }

    const connectorId = task.config.connectorId as string | undefined;
    let results;

    if (connectorId) {
      const result = await this.scanner.scanConnector(connectorId);
      results = [result];
    } else {
      results = await this.scanner.scanAll();
    }

    await this.scanner.processRules(results);

    const totalItems = results.reduce((sum, r) => sum + r.newItems.length, 0);
    return `Scanned ${results.length} connector(s), found ${totalItems} new item(s)`;
  }

  private async executeSkill(task: ScheduledTaskRecord): Promise<string> {
    if (!this.engineManager) {
      throw new Error('Engine manager not available');
    }

    const skillId = task.config.skillId as string | undefined;
    if (!skillId) throw new Error('No skillId in task config');

    const vars = (task.config.variables as Record<string, string>) ?? {};
    const { SkillLoader } = await import('../skills/loader');
    const { SkillExecutor } = await import('../skills/executor');
    const loader = new SkillLoader();
    const skills = await loader.loadAll();
    const skill = skills.find((s) => s.id === skillId);
    if (!skill) throw new Error(`Skill not found: ${skillId}`);

    const executor = new SkillExecutor(this.engineManager);
    let output = '';

    if (skill.type === 'workflow' && skill.steps?.length) {
      for await (const ev of executor.executeWorkflow(skill, vars)) {
        const e = ev as { type: string; content?: string };
        if (e.type === 'text' && e.content) output += e.content;
      }
    } else {
      for await (const ev of executor.executeSimple(skill, vars)) {
        const e = ev as { type: string; content?: string };
        if (e.type === 'text' && e.content) output += e.content;
      }
    }

    return output;
  }

  private async executeNotify(task: ScheduledTaskRecord): Promise<string> {
    const message = task.config.message as string || 'Scheduled notification';
    const title = task.config.title as string || task.name;

    // Dispatch to Electron notification system
    try {
      const { getNotificationManager } = await import('../ipc');
      const nm = getNotificationManager();
      nm.send({
        title,
        body: message,
        urgency: (task.config.urgency as 'low' | 'normal' | 'critical') ?? 'normal',
      });
    } catch {
      // Notification manager not ready (e.g., during startup)
    }

    return `Notification sent: ${message}`;
  }

  private toRecord(row: typeof scheduledTasks.$inferSelect): ScheduledTaskRecord {
    return {
      id: row.id,
      name: row.name,
      cronExpression: row.cronExpression,
      timezone: row.timezone ?? 'Asia/Shanghai',
      type: row.type as TaskType,
      config: row.config ? (() => { try { return JSON.parse(row.config); } catch { return {}; } })() : {},
      enabled: row.enabled === 1,
      lastRunAt: row.lastRunAt,
      nextRunAt: row.nextRunAt,
      cloudSync: row.cloudSync === 1,
      createdAt: row.createdAt,
    };
  }
}
