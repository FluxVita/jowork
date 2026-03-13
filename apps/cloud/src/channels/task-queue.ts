/**
 * In-memory task queue for offline users.
 * When a user's desktop is offline, tasks are queued here.
 * When the desktop reconnects, queued tasks are drained and forwarded.
 */

const MAX_QUEUE_PER_USER = 100;
const TASK_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface QueuedTask {
  id: string;
  userId: string;
  type: string;
  payload: Record<string, unknown>;
  source: string; // 'feishu' | 'scheduler' | etc.
  queuedAt: Date;
}

class TaskQueue {
  private queues = new Map<string, QueuedTask[]>();

  /** Add a task to the user's queue. */
  enqueue(userId: string, task: Omit<QueuedTask, 'id' | 'queuedAt'>): QueuedTask {
    const queued: QueuedTask = {
      ...task,
      id: `qtask_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      queuedAt: new Date(),
    };

    let queue = this.queues.get(userId) ?? [];
    // Evict expired tasks
    const now = Date.now();
    queue = queue.filter((t) => now - t.queuedAt.getTime() < TASK_TTL_MS);
    // Enforce max queue size — drop oldest if full
    if (queue.length >= MAX_QUEUE_PER_USER) {
      queue = queue.slice(queue.length - MAX_QUEUE_PER_USER + 1);
    }
    queue.push(queued);
    this.queues.set(userId, queue);

    return queued;
  }

  /** Get all queued tasks for a user without removing them. */
  peek(userId: string): QueuedTask[] {
    return this.queues.get(userId) ?? [];
  }

  /** Drain all queued tasks for a user (returns and removes them). */
  drain(userId: string): QueuedTask[] {
    const tasks = this.queues.get(userId) ?? [];
    this.queues.delete(userId);
    return tasks;
  }

  /** Remove a specific task by ID. */
  remove(userId: string, taskId: string): void {
    const queue = this.queues.get(userId);
    if (!queue) return;
    const filtered = queue.filter((t) => t.id !== taskId);
    if (filtered.length === 0) {
      this.queues.delete(userId);
    } else {
      this.queues.set(userId, filtered);
    }
  }

  /** Get the number of queued tasks for a user. */
  count(userId: string): number {
    return (this.queues.get(userId) ?? []).length;
  }

  /** Get total queued tasks across all users. */
  totalCount(): number {
    let total = 0;
    for (const queue of this.queues.values()) {
      total += queue.length;
    }
    return total;
  }
}

export const taskQueue = new TaskQueue();
