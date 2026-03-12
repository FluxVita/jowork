/**
 * Cloud task queue for scheduled tasks.
 * In production, this would use BullMQ + Redis.
 * For now, a simple in-memory queue as placeholder.
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

  enqueue(task: Omit<QueuedTask, 'status'>): void {
    this.queue.push({ ...task, status: 'pending' });
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
}
