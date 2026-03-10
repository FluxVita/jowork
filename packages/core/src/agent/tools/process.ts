/**
 * agent/tools/process.ts — Phase 2.4: Process Management Tool (P2)
 *
 * 配合 run_command 的 background 模式使用。
 * Actions: list, poll, log, kill
 */
import type { Tool, ToolContext } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:process');

// ─── 进程跟踪存储 ───

export interface TrackedProcess {
  pid: number;
  command: string;
  startedAt: number;
  status: 'running' | 'exited' | 'killed';
  exitCode?: number;
  output: string[];
  /** 输出行数限制 */
  maxOutputLines: number;
}

/** 全局进程追踪 Map */
const trackedProcesses = new Map<string, TrackedProcess>();

/** 清理已完成进程（保留 30min） */
const RETENTION_MS = 30 * 60 * 1000;

function cleanupStale(): void {
  const now = Date.now();
  for (const [id, proc] of trackedProcesses) {
    if (proc.status !== 'running' && now - proc.startedAt > RETENTION_MS) {
      trackedProcesses.delete(id);
    }
  }
}

/** 注册一个被追踪的进程（由 run_command 调用） */
export function trackProcess(processId: string, pid: number, command: string): void {
  trackedProcesses.set(processId, {
    pid,
    command,
    startedAt: Date.now(),
    status: 'running',
    output: [],
    maxOutputLines: 1000,
  });
}

/** 追加进程输出 */
export function appendProcessOutput(processId: string, line: string): void {
  const proc = trackedProcesses.get(processId);
  if (!proc) return;
  proc.output.push(line);
  if (proc.output.length > proc.maxOutputLines) {
    proc.output.shift();
  }
}

/** 标记进程退出 */
export function markProcessExited(processId: string, exitCode: number): void {
  const proc = trackedProcesses.get(processId);
  if (!proc) return;
  proc.status = 'exited';
  proc.exitCode = exitCode;
}

// ─── Tool ───

export const processTool: Tool = {
  name: 'process',
  description:
    'Manage background processes started via run_command. Actions: "list" (show all tracked processes), "poll" (check status and recent output of a process), "log" (get full output buffer), "kill" (terminate a process).',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'poll', 'log', 'kill'],
        description: 'Action to perform',
      },
      process_id: {
        type: 'string',
        description: 'Process ID (required for poll/log/kill)',
      },
      tail: {
        type: 'number',
        description: 'For poll/log: show last N lines of output (default: 20 for poll, all for log)',
      },
    },
    required: ['action'],
  },

  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const action = input['action'] as string;
    const processId = input['process_id'] as string | undefined;
    const tail = input['tail'] as number | undefined;

    cleanupStale();

    try {
      switch (action) {
        case 'list':
          return handleList();
        case 'poll':
          return handlePoll(processId, tail ?? 20);
        case 'log':
          return handleLog(processId, tail);
        case 'kill':
          return handleKill(processId);
        default:
          return `Unknown action: ${action}. Valid: list, poll, log, kill`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`process tool error: ${action}`, err);
      return `Error: ${msg}`;
    }
  },
};

function handleList(): string {
  if (trackedProcesses.size === 0) {
    return 'No tracked processes.';
  }

  const lines = ['## Tracked Processes', ''];
  for (const [id, proc] of trackedProcesses) {
    const age = formatDuration(Date.now() - proc.startedAt);
    const statusIcon = proc.status === 'running' ? 'RUNNING' : proc.status === 'exited' ? `EXITED(${proc.exitCode})` : 'KILLED';
    lines.push(`- **${id}** [${statusIcon}] — PID ${proc.pid}`);
    lines.push(`  Command: \`${proc.command.slice(0, 80)}\``);
    lines.push(`  Age: ${age} | Output lines: ${proc.output.length}`);
  }

  return lines.join('\n');
}

function handlePoll(processId: string | undefined, tail: number): string {
  if (!processId) return 'Error: process_id is required.';

  const proc = trackedProcesses.get(processId);
  if (!proc) return `Error: Process not found: ${processId}`;

  const lines = [
    `Process ${processId}: ${proc.status}${proc.exitCode !== undefined ? ` (exit code: ${proc.exitCode})` : ''}`,
    `PID: ${proc.pid} | Command: ${proc.command.slice(0, 80)}`,
    `Age: ${formatDuration(Date.now() - proc.startedAt)}`,
    '',
  ];

  const recentOutput = proc.output.slice(-tail);
  if (recentOutput.length > 0) {
    lines.push(`Last ${recentOutput.length} lines of output:`);
    lines.push('```');
    lines.push(...recentOutput);
    lines.push('```');
  } else {
    lines.push('(no output yet)');
  }

  return lines.join('\n');
}

function handleLog(processId: string | undefined, tail: number | undefined): string {
  if (!processId) return 'Error: process_id is required.';

  const proc = trackedProcesses.get(processId);
  if (!proc) return `Error: Process not found: ${processId}`;

  const output = tail ? proc.output.slice(-tail) : proc.output;

  if (output.length === 0) {
    return `Process ${processId}: No output captured.`;
  }

  return [
    `Process ${processId} output (${output.length}${tail ? ` of ${proc.output.length}` : ''} lines):`,
    '```',
    ...output,
    '```',
  ].join('\n');
}

function handleKill(processId: string | undefined): string {
  if (!processId) return 'Error: process_id is required.';

  const proc = trackedProcesses.get(processId);
  if (!proc) return `Error: Process not found: ${processId}`;

  if (proc.status !== 'running') {
    return `Process ${processId} is already ${proc.status}.`;
  }

  try {
    process.kill(proc.pid, 'SIGTERM');

    // SIGKILL 兜底：5 秒后检查进程是否仍在运行
    setTimeout(() => {
      try {
        process.kill(proc.pid, 0); // 探测进程是否存活
        process.kill(proc.pid, 'SIGKILL');
        log.warn(`Process ${processId} (PID ${proc.pid}) did not exit after SIGTERM, sent SIGKILL`);
      } catch { /* 进程已退出，无需 SIGKILL */ }
    }, 5000);

    proc.status = 'killed';
    return `Sent SIGTERM to process ${processId} (PID ${proc.pid}). Will SIGKILL after 5s if still alive.`;
  } catch (err) {
    // Process might have already exited
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('ESRCH')) {
      proc.status = 'exited';
      return `Process ${processId} has already exited.`;
    }
    return `Error killing process: ${msg}`;
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ${secs % 60}s`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ${mins % 60}m`;
}
