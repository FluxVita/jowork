import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
import { createLogger } from '../utils/logger.js';
import { agentChat, type AgentChatOpts } from './controller.js';
import { getAllMcpToolDefs, executeMcpTool } from './mcp-bridge.js';
import { getAllSkillToolDefs, getAllSkillPrompts } from '../skills/manager.js';
import { executeSkillTool } from '../skills/executor.js';
import { assembleContextPrompt } from '../context/docs.js';

const log = createLogger('agent-tasks');

// ─── Types ───

export interface AgentTaskRecord {
  task_id: string;
  title: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  trigger_type: 'manual' | 'auto_diagnose';
  trigger_by: string;
  prompt: string;
  session_id: string | null;
  result_summary: string | null;
  mr_url: string | null;
  error_message: string | null;
  phase: string | null;
  tool_rounds: number;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── CRUD ───

export function createAgentTask(opts: {
  title: string;
  prompt: string;
  trigger_by: string;
  trigger_type?: 'manual' | 'auto_diagnose';
}): string {
  const db = getDb();
  const taskId = genId('atask');
  db.prepare(`
    INSERT INTO agent_tasks (task_id, title, prompt, trigger_by, trigger_type)
    VALUES (?, ?, ?, ?, ?)
  `).run(taskId, opts.title, opts.prompt, opts.trigger_by, opts.trigger_type ?? 'manual');
  return taskId;
}

export function getAgentTask(taskId: string): AgentTaskRecord | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM agent_tasks WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;
  return row ? rowToTask(row) : null;
}

export function listAgentTasks(limit = 50): AgentTaskRecord[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM agent_tasks ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as Record<string, unknown>[];
  return rows.map(rowToTask);
}

export function updateAgentTask(taskId: string, fields: Partial<Pick<AgentTaskRecord, 'status' | 'session_id' | 'result_summary' | 'mr_url' | 'error_message' | 'phase' | 'tool_rounds' | 'started_at' | 'completed_at'>>): void {
  const db = getDb();
  const sets: string[] = ['updated_at = datetime(\'now\')'];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) {
      sets.push(`${k} = ?`);
      values.push(v);
    }
  }
  values.push(taskId);
  db.prepare(`UPDATE agent_tasks SET ${sets.join(', ')} WHERE task_id = ?`).run(...values);
}

function rowToTask(row: Record<string, unknown>): AgentTaskRecord {
  return {
    task_id: row['task_id'] as string,
    title: row['title'] as string,
    status: row['status'] as AgentTaskRecord['status'],
    trigger_type: row['trigger_type'] as AgentTaskRecord['trigger_type'],
    trigger_by: row['trigger_by'] as string,
    prompt: row['prompt'] as string,
    session_id: row['session_id'] as string | null,
    result_summary: row['result_summary'] as string | null,
    mr_url: row['mr_url'] as string | null,
    error_message: row['error_message'] as string | null,
    phase: row['phase'] as string | null,
    tool_rounds: row['tool_rounds'] as number,
    started_at: row['started_at'] as string | null,
    completed_at: row['completed_at'] as string | null,
    created_at: row['created_at'] as string,
    updated_at: row['updated_at'] as string,
  };
}

// ─── Background Execution ───

/**
 * Fire-and-forget: 后台执行 agent 任务。
 * 调用方无需 await（但可以 await 用于测试）。
 */
export async function runAgentTaskBackground(taskId: string): Promise<void> {
  const task = getAgentTask(taskId);
  if (!task) {
    log.error(`Task ${taskId} not found`);
    return;
  }

  // 找一个 owner 用户作为执行身份
  const db = getDb();
  const ownerRow = db.prepare("SELECT user_id, role FROM users WHERE role = 'owner' LIMIT 1").get() as { user_id: string; role: string } | undefined;
  const userId = task.trigger_by !== 'system' ? task.trigger_by : (ownerRow?.user_id ?? 'system');
  const role = ownerRow?.role ?? 'owner';

  updateAgentTask(taskId, {
    status: 'running',
    started_at: new Date().toISOString(),
  });

  log.info(`Starting background task ${taskId}: ${task.title}`);

  try {
    // 收集 extra tools
    let extraTools = [...getAllSkillToolDefs()];
    try {
      const mcpTools = await getAllMcpToolDefs();
      extraTools = [...extraTools, ...mcpTools];
    } catch (err) {
      log.warn('Failed to load MCP tools for background task', String(err));
    }

    const extraPrompts = getAllSkillPrompts();
    const contextPrompt = assembleContextPrompt({ userId, query: task.prompt.slice(0, 200) });
    if (contextPrompt) extraPrompts.push(contextPrompt);

    const externalToolExecutor = async (name: string, input: Record<string, unknown>): Promise<string> => {
      if (name.startsWith('mcp_')) return executeMcpTool(name, input);
      if (name.startsWith('skill_')) return executeSkillTool(name, input);
      throw new Error(`Unknown external tool: ${name}`);
    };

    const chatOpts: AgentChatOpts = {
      userId,
      role: role as AgentChatOpts['role'],
      message: task.prompt,
      engine: 'builtin',
      extraTools: extraTools.length > 0 ? extraTools : undefined,
      extraPrompts: extraPrompts.length > 0 ? extraPrompts : undefined,
      externalToolExecutor: extraTools.length > 0 ? externalToolExecutor : undefined,
    };

    let sessionId: string | null = null;
    let resultSummary = '';
    let mrUrl: string | null = null;
    let toolRounds = 0;

    for await (const event of agentChat(chatOpts)) {
      // 检查任务是否已被取消
      const currentTask = getAgentTask(taskId);
      if (currentTask?.status === 'cancelled') {
        log.info(`Task ${taskId} cancelled, stopping`);
        break;
      }

      switch (event.event) {
        case 'session_created':
          sessionId = event.data.session_id;
          updateAgentTask(taskId, { session_id: sessionId });
          break;

        case 'activity':
          updateAgentTask(taskId, { phase: event.data.message });
          break;

        case 'tool_call':
          toolRounds++;
          updateAgentTask(taskId, { tool_rounds: toolRounds });
          break;

        case 'tool_result':
          // 尝试从 create_gitlab_mr 结果中提取 MR URL
          if (event.data.name === 'create_gitlab_mr' && event.data.status === 'success') {
            const preview = event.data.result_preview ?? '';
            const mrMatch = preview.match(/https?:\/\/[^\s"]+merge_requests\/\d+/);
            if (mrMatch) mrUrl = mrMatch[0];
          }
          break;

        case 'text_done':
          resultSummary = event.data.content;
          // 再次尝试从最终文本中提取 MR URL
          if (!mrUrl) {
            const mrMatch = resultSummary.match(/https?:\/\/[^\s"]+merge_requests\/\d+/);
            if (mrMatch) mrUrl = mrMatch[0];
          }
          break;

        case 'error':
          throw new Error(event.data.message);
      }
    }

    updateAgentTask(taskId, {
      status: 'completed',
      result_summary: resultSummary.slice(0, 5000),
      mr_url: mrUrl,
      completed_at: new Date().toISOString(),
    });

    log.info(`Task ${taskId} completed${mrUrl ? `, MR: ${mrUrl}` : ''}`);

  } catch (err) {
    log.error(`Task ${taskId} failed`, err);
    updateAgentTask(taskId, {
      status: 'failed',
      error_message: String(err).slice(0, 2000),
      completed_at: new Date().toISOString(),
    });
  }
}
