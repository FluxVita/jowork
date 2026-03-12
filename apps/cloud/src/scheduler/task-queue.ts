import { randomBytes } from 'crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { taskExecutionLog } from '../db/schema';
import { CloudExecutor } from './cloud-executor';

/**
 * Cloud task queue for scheduled tasks.
 * Uses in-memory queue with DB-backed execution logging.
 * Production upgrade path: BullMQ + Redis for distributed processing.
 */

interface QueuedTask {
  id: string;
  userId: string;
  taskId: string;
  type: string;
  config: Record<string, unknown>;
  scheduledAt: Date;
  status: 'pending' | 'running' | 'completed' | 'failed';
}

export class TaskQueue {
  private queue: QueuedTask[] = [];
  private executor: CloudExecutor | null = null;
  private processing = false;

  enqueue(task: Omit<QueuedTask, 'status'>): void {
    this.queue.push({ ...task, status: 'pending' });
    this.processNext();
  }

  dequeue(): QueuedTask | undefined {
    const task = this.queue.find((t) => t.status === 'pending');
    if (task) {
      task.status = 'running';
    }
    return task;
  }

  complete(id: string): void {
    const task = this.queue.find((t) => t.id === id);
    if (task) task.status = 'completed';
  }

  fail(id: string): void {
    const task = this.queue.find((t) => t.id === id);
    if (task) task.status = 'failed';
  }

  getPending(): QueuedTask[] {
    return this.queue.filter((t) => t.status === 'pending');
  }

  getByUser(userId: string): QueuedTask[] {
    return this.queue.filter((t) => t.userId === userId);
  }

  /**
   * Process the next pending task. Non-blocking.
   */
  private async processNext(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const task = this.dequeue();
      if (!task) return;

      if (!this.executor) {
        try {
          this.executor = new CloudExecutor();
        } catch {
          this.fail(task.id);
          await this.logExecution(task, 'failed', null, 'CloudExecutor init failed (no DATABASE_URL?)');
          return;
        }
      }

      const startTime = Date.now();
      let result: string | null = null;
      let error: string | null = null;
      let status = 'success';

      try {
        switch (task.type) {
          case 'scan':
            result = await this.executor.executeScan(task.userId, task.config);
            break;
          case 'skill':
            result = await this.executor.executeSkill(task.userId, task.config);
            break;
          case 'notify':
            result = await this.executor.executeNotify(task.userId, task.config);
            break;
          default:
            status = 'skipped';
            result = `Unknown task type: ${task.type}`;
        }
        this.complete(task.id);
      } catch (err) {
        status = 'failed';
        error = String(err);
        this.fail(task.id);
      }

      const durationMs = Date.now() - startTime;
      await this.logExecution(task, status, result, error, durationMs);
    } finally {
      this.processing = false;
      // Check if more pending
      if (this.queue.some((t) => t.status === 'pending')) {
        this.processNext();
      }
    }
  }

  private async logExecution(
    task: QueuedTask,
    status: string,
    result: string | null,
    error: string | null,
    durationMs?: number,
  ): Promise<void> {
    try {
      const db = getDb();
      await db.insert(taskExecutionLog).values({
        id: `exec_${randomBytes(8).toString('hex')}`,
        taskId: task.taskId,
        status,
        result,
        error,
        durationMs: durationMs ?? 0,
      });
    } catch {
      // Non-critical — log execution recording failed
      console.error(`[TaskQueue] Failed to log execution for task ${task.id}`);
    }
  }

  /**
   * Get recent executions for a task (from DB).
   */
  async getExecutions(taskId: string, limit = 20) {
    try {
      const db = getDb();
      return await db.select().from(taskExecutionLog)
        .where(eq(taskExecutionLog.taskId, taskId))
        .orderBy(desc(taskExecutionLog.executedAt))
        .limit(limit);
    } catch {
      return [];
    }
  }
}
