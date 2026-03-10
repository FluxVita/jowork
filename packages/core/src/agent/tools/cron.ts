/**
 * agent/tools/cron.ts — Phase 2.1: Dynamic Cron Tool (P0)
 *
 * Agent 可通过此 tool 创建/管理定时任务。
 * Actions: status, list, add, update, remove, run
 *
 * 移植 OpenClaw 的 flat-params recovery 模式。
 */
import type { Tool, ToolContext } from '../types.js';
import {
  createCronTask,
  listCronTasks,
  getCronTask,
  updateCronTask,
  deleteCronTask,
} from '../../scheduler/index.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:cron');

export const cronTool: Tool = {
  name: 'cron',
  description:
    'Manage scheduled/recurring tasks. Actions: "status" (overview of all tasks), "list" (detailed list), "add" (create new task), "update" (modify existing), "remove" (delete task), "run" (execute immediately). For "add", provide a job object with name, schedule (cron expression), and optionally message (for agent_turn tasks).',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['status', 'list', 'add', 'update', 'remove', 'run'],
        description: 'The action to perform',
      },
      job_id: {
        type: 'string',
        description: 'Task ID (required for update/remove/run)',
      },
      job: {
        type: 'object',
        description: 'Task definition (for add/update)',
        properties: {
          name: { type: 'string', description: 'Task display name' },
          schedule: { type: 'string', description: 'Cron expression (e.g. "*/5 * * * *" for every 5 minutes)' },
          schedule_type: { type: 'string', enum: ['cron', 'at', 'every'], description: 'Schedule type (default: cron)' },
          message: { type: 'string', description: 'Agent prompt for agent_turn tasks' },
          payload_type: { type: 'string', enum: ['sync', 'agent_turn', 'system_event'], description: 'Task payload type (default: agent_turn)' },
          delivery_mode: { type: 'string', enum: ['none', 'announce', 'webhook'], description: 'Result delivery mode' },
          delivery_channel: { type: 'string', description: 'Delivery target (feishu chat ID, webhook URL, etc.)' },
          delivery_to: { type: 'string', description: 'Delivery recipient user ID' },
          enabled: { type: 'boolean', description: 'Whether the task is enabled (default: true)' },
        },
      },
      // Flat-params recovery: non-frontier models may flatten nested params
      name: { type: 'string', description: '(flat fallback) Task name' },
      schedule: { type: 'string', description: '(flat fallback) Cron expression' },
      message: { type: 'string', description: '(flat fallback) Agent prompt' },
    },
    required: ['action'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = input['action'] as string;

    // Flat-params recovery: if job is missing but flat params are present, reconstruct
    let job = input['job'] as Record<string, unknown> | undefined;
    if (!job && (input['name'] || input['schedule'] || input['message'])) {
      job = {};
      if (input['name']) job['name'] = input['name'];
      if (input['schedule']) job['schedule'] = input['schedule'];
      if (input['message']) job['message'] = input['message'];
    }

    const jobId = input['job_id'] as string | undefined;

    try {
      switch (action) {
        case 'status':
          return handleStatus();
        case 'list':
          return handleList();
        case 'add':
          return handleAdd(job, ctx);
        case 'update':
          return handleUpdate(jobId, job);
        case 'remove':
          return handleRemove(jobId);
        case 'run':
          return handleRun(jobId);
        default:
          return `Unknown action: ${action}. Valid actions: status, list, add, update, remove, run`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`cron tool error: ${action}`, err);
      return `Error: ${msg}`;
    }
  },
};

function handleStatus(): string {
  const tasks = listCronTasks();
  const enabled = tasks.filter(t => t.enabled);
  const disabled = tasks.filter(t => !t.enabled);
  const lines = [
    `## Cron Tasks Overview`,
    `Total: ${tasks.length} (${enabled.length} enabled, ${disabled.length} disabled)`,
    '',
  ];

  if (enabled.length > 0) {
    lines.push('### Active Tasks');
    for (const t of enabled) {
      lines.push(`- **${t.name}** (${t.task_id})`);
      lines.push(`  Schedule: \`${t.cron_expr}\` | Last run: ${t.last_run_at ?? 'never'} | Next: ${t.next_run_at ?? 'N/A'}`);
    }
  }

  if (disabled.length > 0) {
    lines.push('', '### Disabled Tasks');
    for (const t of disabled) {
      lines.push(`- ${t.name} (${t.task_id})`);
    }
  }

  return lines.join('\n');
}

function handleList(): string {
  const tasks = listCronTasks();
  if (tasks.length === 0) return 'No cron tasks found.';

  return tasks.map(t => [
    `### ${t.name}`,
    `- ID: ${t.task_id}`,
    `- Schedule: \`${t.cron_expr}\``,
    `- Type: ${t.action_type}`,
    `- Enabled: ${t.enabled ? 'yes' : 'no'} | Approved: ${t.approved ? 'yes' : 'no'}`,
    `- Last run: ${t.last_run_at ?? 'never'}`,
    `- Next run: ${t.next_run_at ?? 'N/A'}`,
    `- Created by: ${t.created_by}`,
  ].join('\n')).join('\n\n');
}

function handleAdd(job: Record<string, unknown> | undefined, ctx: ToolContext): string {
  if (!job) return 'Error: "job" object is required for add action. Provide at least name and schedule.';

  const name = job['name'] as string | undefined;
  const schedule = job['schedule'] as string | undefined;

  if (!name) return 'Error: job.name is required.';
  if (!schedule) return 'Error: job.schedule (cron expression) is required.';

  // 基本 cron 表达式校验（5 段: min hour dom month dow）
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5 || parts.length > 6) {
    return `Error: Invalid cron expression "${schedule}". Expected 5 fields: minute hour day-of-month month day-of-week (e.g. "*/5 * * * *").`;
  }

  const payloadType = (job['payload_type'] as string) ?? 'agent_turn';
  const message = job['message'] as string | undefined;

  const taskId = createCronTask({
    name,
    cron_expr: schedule,
    action_type: payloadType === 'agent_turn' ? 'custom' : (payloadType as 'sync' | 'custom'),
    action_config: {
      ...(message ? { template: message } : {}),
      ...(job['delivery_channel'] ? { target_channel: job['delivery_channel'] as string } : {}),
      ...(job['delivery_to'] ? { target_user_id: job['delivery_to'] as string } : {}),
    },
    created_by: ctx.user_id,
    approved: true, // agent-created tasks are auto-approved
    enabled: job['enabled'] !== false,
  });

  log.info(`Cron task created by agent: ${name} (${taskId})`);
  return `Task created successfully.\n- ID: ${taskId}\n- Name: ${name}\n- Schedule: \`${schedule}\`\n- Type: ${payloadType}`;
}

function handleUpdate(jobId: string | undefined, job: Record<string, unknown> | undefined): string {
  if (!jobId) return 'Error: job_id is required for update action.';
  if (!job) return 'Error: job object with updates is required.';

  const existing = getCronTask(jobId);
  if (!existing) return `Error: Task not found: ${jobId}`;

  const updates: Record<string, unknown> = {};
  if (job['name'] !== undefined) updates['name'] = job['name'];
  if (job['schedule'] !== undefined) updates['cron_expr'] = job['schedule'];
  if (job['enabled'] !== undefined) updates['enabled'] = job['enabled'];

  updateCronTask(jobId, updates as Parameters<typeof updateCronTask>[1]);
  return `Task updated: ${jobId}\n${Object.entries(updates).map(([k, v]) => `- ${k}: ${v}`).join('\n')}`;
}

function handleRemove(jobId: string | undefined): string {
  if (!jobId) return 'Error: job_id is required for remove action.';

  const existing = getCronTask(jobId);
  if (!existing) return `Error: Task not found: ${jobId}`;

  deleteCronTask(jobId);
  log.info(`Cron task removed by agent: ${existing.name} (${jobId})`);
  return `Task removed: ${existing.name} (${jobId})`;
}

function handleRun(jobId: string | undefined): string {
  if (!jobId) return 'Error: job_id is required for run action.';

  const existing = getCronTask(jobId);
  if (!existing) return `Error: Task not found: ${jobId}`;

  // Note: actual execution is handled by the scheduler's executor.
  // For now, return the task info so the agent knows what would run.
  // Full agent_turn execution will be implemented in Phase 3.
  return `Task "${existing.name}" is scheduled for immediate execution.\nSchedule: \`${existing.cron_expr}\`\nAction: ${existing.action_type}\n\nNote: Immediate execution via agent_turn will be available in a future update. Currently, the task will execute at its next scheduled time.`;
}
