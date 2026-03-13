import type { Context } from 'hono';
import { randomBytes } from 'crypto';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { cloudScheduledTasks, taskExecutionLog } from '../db/schema';

/**
 * POST /scheduler/tasks — create a scheduled task
 */
export async function createTask(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const body = await c.req.json<{
    name: string;
    cronExpression: string;
    timezone?: string;
    type: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }>();

  if (!body.name?.trim() || !body.cronExpression?.trim() || !body.type?.trim()) {
    return c.json({ error: 'name, cronExpression, and type are required' }, 400);
  }

  const id = `ctask_${randomBytes(8).toString('hex')}`;
  const db = getDb();

  await db.insert(cloudScheduledTasks).values({
    id,
    userId,
    name: body.name,
    cronExpression: body.cronExpression,
    timezone: body.timezone || 'Asia/Shanghai',
    type: body.type,
    config: body.config || {},
    enabled: body.enabled ?? true,
  });

  const [task] = await db.select().from(cloudScheduledTasks).where(eq(cloudScheduledTasks.id, id));
  return c.json(task, 201);
}

/**
 * GET /scheduler/tasks — list user's scheduled tasks
 */
export async function listTasks(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const db = getDb();

  const tasks = await db.select().from(cloudScheduledTasks)
    .where(eq(cloudScheduledTasks.userId, userId))
    .orderBy(desc(cloudScheduledTasks.createdAt));

  return c.json(tasks);
}

/**
 * PATCH /scheduler/tasks/:id — update a scheduled task
 */
export async function updateTask(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const taskId = c.req.param('id')!;
  const db = getDb();

  const [existing] = await db.select().from(cloudScheduledTasks)
    .where(and(eq(cloudScheduledTasks.id, taskId), eq(cloudScheduledTasks.userId, userId)));

  if (!existing) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const body = await c.req.json<{
    name?: string;
    cronExpression?: string;
    timezone?: string;
    type?: string;
    config?: Record<string, unknown>;
    enabled?: boolean;
  }>();

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.cronExpression !== undefined) updates.cronExpression = body.cronExpression;
  if (body.timezone !== undefined) updates.timezone = body.timezone;
  if (body.type !== undefined) updates.type = body.type;
  if (body.config !== undefined) updates.config = body.config;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  await db.update(cloudScheduledTasks).set(updates)
    .where(eq(cloudScheduledTasks.id, taskId));

  const [updated] = await db.select().from(cloudScheduledTasks).where(eq(cloudScheduledTasks.id, taskId));
  return c.json(updated);
}

/**
 * DELETE /scheduler/tasks/:id — delete a scheduled task
 */
export async function deleteTask(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const taskId = c.req.param('id')!;
  const db = getDb();

  const [existing] = await db.select().from(cloudScheduledTasks)
    .where(and(eq(cloudScheduledTasks.id, taskId), eq(cloudScheduledTasks.userId, userId)));

  if (!existing) {
    return c.json({ error: 'Task not found' }, 404);
  }

  // Delete execution log entries first
  await db.delete(taskExecutionLog).where(eq(taskExecutionLog.taskId, taskId));
  await db.delete(cloudScheduledTasks).where(eq(cloudScheduledTasks.id, taskId));

  return c.json({ deleted: true });
}

/**
 * GET /scheduler/executions/:taskId — get execution history for a task
 */
export async function getExecutions(c: Context): Promise<Response> {
  const userId = c.get('userId') as string;
  const taskId = c.req.param('taskId')!;
  const limit = parseInt(c.req.query('limit') || '20', 10);
  const db = getDb();

  // Verify task belongs to user
  const [task] = await db.select().from(cloudScheduledTasks)
    .where(and(eq(cloudScheduledTasks.id, taskId), eq(cloudScheduledTasks.userId, userId)));

  if (!task) {
    return c.json({ error: 'Task not found' }, 404);
  }

  const executions = await db.select().from(taskExecutionLog)
    .where(eq(taskExecutionLog.taskId, taskId))
    .orderBy(desc(taskExecutionLog.executedAt))
    .limit(limit);

  return c.json(executions);
}
