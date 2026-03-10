/**
 * scheduler/agent-turn.ts — Phase 3.1: Cron Agent Turn Execution
 *
 * 在 scheduler tick 中处理 agent_turn 类型的 cron 任务。
 * 创建 isolated session，执行 agent loop，分发结果。
 */
import { agentChat } from '../agent/controller.js';
import { createSession } from '../agent/session.js';
import type { AgentEvent } from '../agent/types.js';
import { executeExternalTool } from '../agent/tools/external-executor.js';
import { getAllMcpToolDefs } from '../agent/mcp-bridge.js';
import { getAllSkillToolDefs, getAllSkillPrompts } from '../skills/manager.js';
import { emit } from '../hooks/engine.js';
import { createLogger } from '../utils/logger.js';

const log = createLogger('cron-agent-turn');

// ─── 并发控制 ───

let activeRuns = 0;
let maxConcurrent = 2;

export function setMaxConcurrent(n: number): void {
  maxConcurrent = n;
}

export function getActiveRunCount(): number {
  return activeRuns;
}

// ─── Delivery ───

async function dispatchDelivery(
  mode: string,
  config: Record<string, unknown>,
  content: string,
): Promise<void> {
  switch (mode) {
    case 'announce': {
      // 飞书消息投递（使用 bot tenant token）
      const channel = config['channel'] as string | undefined;
      const to = config['to'] as string | undefined;
      const receiveId = to || channel;
      const receiveType = to ? 'open_id' : 'chat_id';
      if (receiveId) {
        log.info(`Delivering to feishu: ${receiveType}=${receiveId}`);
        try {
          const { feishuApi } = await import('../connectors/feishu/auth.js');
          await feishuApi(`/im/v1/messages`, {
            method: 'POST',
            params: { receive_id_type: receiveType },
            body: {
              receive_id: receiveId,
              msg_type: 'text',
              content: JSON.stringify({ text: content.slice(0, 4000) }),
            },
          });
        } catch (err) {
          log.error('Feishu delivery failed:', err);
        }
      }
      break;
    }
    case 'webhook': {
      const webhookUrl = config['webhookUrl'] as string | undefined;
      if (webhookUrl) {
        log.info(`Delivering to webhook: ${webhookUrl}`);
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content,
              timestamp: new Date().toISOString(),
            }),
          });
        } catch (err) {
          log.error(`Webhook delivery failed: ${webhookUrl}`, err);
        }
      }
      break;
    }
    case 'none':
    default:
      // 仅记录日志
      break;
  }
}

// ─── 主执行函数 ───

export interface CronAgentTurnTask {
  task_id: string;
  name: string;
  created_by: string;
  action_config: {
    template?: string;
    target_channel?: string;
    target_user_id?: string;
  };
  // Phase 0 新增字段
  payload_config_json?: string;
  delivery_mode?: string;
  delivery_config_json?: string;
}

/**
 * 执行 cron agent turn
 *
 * 1. 创建 isolated session（type='cron'）
 * 2. 运行 agent loop
 * 3. 收集结果并分发
 */
export async function executeAgentTurn(task: CronAgentTurnTask): Promise<{
  sessionId: string;
  output: string;
  status: 'success' | 'error';
}> {
  // 并发检查
  if (activeRuns >= maxConcurrent) {
    log.warn(`Skipping cron agent turn (${task.name}): max concurrent runs reached (${maxConcurrent})`);
    return { sessionId: '', output: 'Skipped: max concurrent runs reached', status: 'error' };
  }

  activeRuns++;

  try {
    // 解析配置
    const payloadConfig = task.payload_config_json
      ? JSON.parse(task.payload_config_json) as Record<string, unknown>
      : task.action_config;

    const message = ((payloadConfig as Record<string, unknown>)['template'] ?? (payloadConfig as Record<string, unknown>)['message'] ?? `Execute cron task: ${task.name}`) as string;

    const deliveryMode = task.delivery_mode ?? 'none';
    const deliveryConfig = task.delivery_config_json
      ? JSON.parse(task.delivery_config_json) as Record<string, unknown>
      : {
          channel: task.action_config.target_channel,
          to: task.action_config.target_user_id,
        };

    // 1. 创建 isolated session
    const session = createSession(
      task.created_by || 'system',
      `cron:${task.name}`,
      'builtin',
      { sessionType: 'cron' },
    );
    const sessionId = session.session_id;

    log.info(`Cron agent turn started: ${task.name} → session ${sessionId}`);

    // 2. 加载 MCP/Skill 工具（cron agent 也需要外部工具能力）
    let extraTools: import('../agent/types.js').AnthropicToolDef[] = [];
    try {
      const [mcpTools, skillTools] = await Promise.all([
        getAllMcpToolDefs().catch(() => []),
        Promise.resolve(getAllSkillToolDefs()),
      ]);
      extraTools = [...mcpTools, ...skillTools];
    } catch { /* 外部工具不可用时降级为仅内置工具 */ }

    const extraPrompts = getAllSkillPrompts();

    // 3. 运行 agent loop（带超时保护）
    const CRON_TIMEOUT_MS = 5 * 60 * 1000; // 5 分钟
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CRON_TIMEOUT_MS);

    let output = '';
    let lastError = '';

    try {
      const events = agentChat({
        userId: task.created_by || 'system',
        role: 'admin',
        sessionId,
        message,
        signal: controller.signal,
        extraTools: extraTools.length > 0 ? extraTools : undefined,
        extraPrompts: extraPrompts.length > 0 ? extraPrompts : undefined,
        externalToolExecutor: extraTools.length > 0 ? executeExternalTool : undefined,
      });

      for await (const event of events) {
        if (event.event === 'text_done') {
          output = (event as Extract<AgentEvent, { event: 'text_done' }>).data.content;
        } else if (event.event === 'error') {
          lastError = (event as Extract<AgentEvent, { event: 'error' }>).data.message;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    // 3. Delivery
    if (output && deliveryMode !== 'none') {
      await dispatchDelivery(deliveryMode, deliveryConfig, output);
    }

    // 4. Emit hook event
    const status = lastError ? 'error' : 'success';
    emit(status === 'success' ? 'cron:complete' : 'cron:error', {
      taskId: task.task_id,
      taskName: task.name,
      sessionId,
      output: output.slice(0, 500),
      error: lastError || undefined,
    });

    log.info(`Cron agent turn completed: ${task.name} (${status})`);
    return { sessionId, output: output || lastError, status };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Cron agent turn failed: ${task.name}`, err);

    emit('cron:error', {
      taskId: task.task_id,
      taskName: task.name,
      error: msg,
    });

    return { sessionId: '', output: msg, status: 'error' };
  } finally {
    activeRuns--;
  }
}
