/**
 * agent/subagent/spawn.ts — Phase 4.1: Sub-agent Spawn Mechanism
 *
 * Agent-Centric 设计：
 * - Sub-agent 拿到完整 tool list（与主 agent 一样）
 * - 通过 system prompt 注入角色说明和限制
 * - 唯一硬限制：depth/concurrent 在执行层检查
 */
import { agentChat } from '../controller.js';
import { createSession, getSession } from '../session.js';
import { config as gatewayConfig } from '../../config.js';
import { executeExternalTool } from '../tools/external-executor.js';
import { getAllMcpToolDefs } from '../mcp-bridge.js';
import { getAllSkillToolDefs, getAllSkillPrompts } from '../../skills/manager.js';
import type { AgentEvent, AnthropicToolDef, SubagentSpawnOpts, SubagentResult } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('subagent');

// ─── 并发追踪 ───

let activeCount = 0;

export function getActiveSubagentCount(): number {
  return activeCount;
}

// ─── 深度计算 ───

export function getSubagentDepth(sessionId: string): number {
  let depth = 0;
  let current = sessionId;

  while (depth < 10) { // 安全上限，防无限循环
    const session = getSession(current);
    if (!session || !session.parent_session_id) break;
    depth++;
    current = session.parent_session_id;
  }

  return depth;
}

// ─── Sub-agent System Prompt ───

function buildSubagentPrompt(opts: SubagentSpawnOpts, depth: number): string {
  const maxDepth = gatewayConfig.agent.subagentMaxDepth;
  return `You are a sub-agent spawned to complete a specific task.
Your parent agent will receive your output when you finish.

## Your Task
${opts.task}

## Guidelines
- Focus on your assigned task. Complete it thoroughly and report back.
- Prefer lightweight tools. Avoid gateway management operations.
- Your session is temporary and will be archived after completion.
- Current depth: ${depth + 1}/${maxDepth}. ${depth + 1 >= maxDepth ? 'You are at max depth — do NOT spawn further sub-agents.' : 'Avoid spawning sub-agents unless absolutely necessary.'}
- When done, provide a clear summary of what you accomplished.`;
}

// ─── Spawn ───

/**
 * 创建并运行一个 sub-agent
 *
 * 安全边界（硬限制）：
 * - depth 超限 → 返回错误
 * - 并发超限 → 返回错误
 * - timeout → 自动终止
 */
export async function spawnSubagent(opts: SubagentSpawnOpts): Promise<SubagentResult> {
  const { subagentMaxDepth, subagentMaxConcurrent } = gatewayConfig.agent;

  // 1. 深度检查
  const depth = getSubagentDepth(opts.parentSessionId);
  if (depth >= subagentMaxDepth) {
    return {
      sessionId: '',
      status: 'error',
      output: `Max spawn depth (${subagentMaxDepth}) exceeded. Current depth: ${depth}. Consider using a different approach instead of spawning another sub-agent.`,
      usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
    };
  }

  // 2. 并发检查
  if (activeCount >= subagentMaxConcurrent) {
    return {
      sessionId: '',
      status: 'error',
      output: `Max concurrent sub-agents (${subagentMaxConcurrent}) reached. Wait for current sub-agents to complete or reduce parallelism.`,
      usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
    };
  }

  activeCount++;

  try {
    // 3. 创建子 session
    const label = opts.label || 'task';
    const session = createSession(
      opts.parentUserId,
      `subagent:${label}`,
      'builtin',
      {
        sessionType: 'subagent',
        parentSessionId: opts.parentSessionId,
        agentConfig: opts.model || opts.thinking
          ? { model: opts.model, thinking: opts.thinking }
          : undefined,
      },
    );
    const sessionId = session.session_id;

    log.info(`Sub-agent spawned: ${label} (session=${sessionId}, parent=${opts.parentSessionId}, depth=${depth + 1})`);

    // 4. 加载 MCP/Skill 工具（sub-agent 与主 agent 同等能力）
    let extraTools: AnthropicToolDef[] = [];
    try {
      const [mcpTools, skillTools] = await Promise.all([
        getAllMcpToolDefs().catch(() => []),
        Promise.resolve(getAllSkillToolDefs()),
      ]);
      extraTools = [...mcpTools, ...skillTools];
    } catch { /* 降级为仅内置工具 */ }

    const skillPrompts = getAllSkillPrompts();
    const extraPrompts = [buildSubagentPrompt(opts, depth), ...skillPrompts];

    // 5. 执行 agent loop
    const timeoutMs = (opts.timeoutSeconds ?? 120) * 1000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    let output = '';
    let lastError = '';
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;

    try {
      const events = agentChat({
        userId: opts.parentUserId,
        role: 'admin',
        sessionId,
        message: opts.task,
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
        } else if (event.event === 'usage') {
          const usage = (event as Extract<AgentEvent, { event: 'usage' }>).data;
          totalTokensIn += usage.tokens_in;
          totalTokensOut += usage.tokens_out;
          totalCost += usage.cost_usd;
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const status = lastError ? 'error' : 'success';
    log.info(`Sub-agent completed: ${label} (${status})`);

    return {
      sessionId,
      status,
      output: output || lastError || '(no output)',
      usage: { tokens_in: totalTokensIn, tokens_out: totalTokensOut, cost_usd: totalCost },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('aborted') || msg.includes('abort')) {
      return {
        sessionId: '',
        status: 'timeout',
        output: `Sub-agent timed out after ${opts.timeoutSeconds ?? 120}s`,
        usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
      };
    }

    log.error(`Sub-agent spawn failed:`, err);
    return {
      sessionId: '',
      status: 'error',
      output: msg,
      usage: { tokens_in: 0, tokens_out: 0, cost_usd: 0 },
    };
  } finally {
    activeCount--;
  }
}
