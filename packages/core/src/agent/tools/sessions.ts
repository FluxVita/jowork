/**
 * agent/tools/sessions.ts — Phase 2.7: Session Management Tool (P1)
 *
 * Agent 可查看/管理 session 列表和历史。
 * 安全：只能查看自己的 session。
 */
import type { Tool, ToolContext, StructuredResult, StructuredListItem } from '../types.js';
import { listSessions, getSession, getMessages } from '../session.js';
import { spawnSubagent } from '../subagent/spawn.js';
import { announceResult } from '../subagent/announce.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:sessions');

/** 脱敏处理：隐藏可能的敏感信息 */
function redactSensitiveText(text: string): string {
  // 脱敏 API key 和 token
  let redacted = text.replace(/(?:api[_-]?key|token|secret|password|auth)[=:]\s*["']?[\w\-./+]{8,}["']?/gi, '[REDACTED]');
  // 脱敏 Bearer token
  redacted = redacted.replace(/Bearer\s+[\w\-./+]{20,}/g, 'Bearer [REDACTED]');
  // 脱敏 base64 encoded credentials
  redacted = redacted.replace(/Basic\s+[A-Za-z0-9+/=]{20,}/g, 'Basic [REDACTED]');
  return redacted;
}

export const sessionsTool: Tool = {
  name: 'sessions',
  description:
    'View and manage your chat sessions. Actions: "list" (show all sessions), "history" (view messages of a specific session), "info" (get session details), "spawn" (create a sub-agent to handle a task in parallel). You can only see your own sessions.',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['list', 'history', 'info', 'spawn'],
        description: 'Action to perform',
      },
      session_id: {
        type: 'string',
        description: 'Session ID (required for history/info)',
      },
      limit: {
        type: 'number',
        description: 'Max results to return (default: 20 for list, 50 for history)',
      },
      offset: {
        type: 'number',
        description: 'Skip first N results (for pagination)',
      },
      // spawn-specific params
      task: {
        type: 'string',
        description: 'For spawn: the task description for the sub-agent',
      },
      label: {
        type: 'string',
        description: 'For spawn: a short label for the sub-agent (e.g. "research", "code-review")',
      },
      timeout_seconds: {
        type: 'number',
        description: 'For spawn: max execution time in seconds (default: 120)',
      },
    },
    required: ['action'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const action = input['action'] as string;
    const sessionId = input['session_id'] as string | undefined;
    const limit = input['limit'] as number | undefined;
    const offset = input['offset'] as number | undefined;

    try {
      switch (action) {
        case 'list':
          return handleList(ctx, limit ?? 20, offset ?? 0);
        case 'history':
          return handleHistory(ctx, sessionId, limit ?? 50, offset ?? 0);
        case 'info':
          return handleInfo(ctx, sessionId);
        case 'spawn':
          return handleSpawn(ctx, input);
        default:
          return `Unknown action: ${action}. Valid: list, history, info, spawn`;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`sessions tool error: ${action}`, err);
      return `Error: ${msg}`;
    }
  },

  async executeStructured(input: Record<string, unknown>, ctx: ToolContext): Promise<{ text: string; structured: StructuredResult }> {
    const action = input['action'] as string;
    const limit = input['limit'] as number | undefined;
    const offset = input['offset'] as number | undefined;

    if (action === 'list') {
      const sessions = listSessions(ctx.user_id, limit ?? 20);
      const items: StructuredListItem[] = sessions.map(s => ({
        title: s.title || `Session ${s.session_id.slice(0, 8)}`,
        description: s.summary ?? `${s.message_count} messages`,
        meta: `${s.session_type} · ${s.engine} · ${new Date(s.created_at).toLocaleDateString()}`,
      }));

      const text = handleList(ctx, limit ?? 20, offset ?? 0);
      return {
        text,
        structured: { type: 'list', items, total: sessions.length },
      };
    }

    const text = await this.execute(input, ctx);
    return { text, structured: { type: 'markdown', content: text } };
  },
};

function handleList(ctx: ToolContext, limit: number, _offset: number): string {
  // listSessions only accepts (userId, limit) — no offset support yet
  const sessions = listSessions(ctx.user_id, limit);

  if (sessions.length === 0) {
    return 'No sessions found.';
  }

  const lines = [`## Your Sessions (${sessions.length} shown)`, ''];
  for (const s of sessions) {
    const type = s.session_type !== 'main' ? ` [${s.session_type}]` : '';
    const age = formatAge(s.created_at);
    lines.push(`- **${s.title || 'Untitled'}**${type} — ${s.session_id.slice(0, 8)}`);
    lines.push(`  ${s.message_count} msgs · ${s.engine} · ${age}`);
    if (s.summary) lines.push(`  Summary: ${s.summary.slice(0, 100)}${s.summary.length > 100 ? '...' : ''}`);
  }

  return lines.join('\n');
}

function handleHistory(ctx: ToolContext, sessionId: string | undefined, limit: number, offset: number): string {
  if (!sessionId) return 'Error: session_id is required for history action.';

  // 权限检查
  const session = getSession(sessionId);
  if (!session) return `Error: Session not found: ${sessionId}`;
  if (session.user_id !== ctx.user_id) {
    return 'Error: You can only view your own sessions.';
  }

  const messages = getMessages(sessionId, { limit, offset });
  if (messages.length === 0) {
    return offset > 0 ? 'No more messages.' : 'Session has no messages.';
  }

  const lines = [
    `## Session History: ${session.title || sessionId.slice(0, 8)}`,
    `Messages ${offset + 1}-${offset + messages.length}`,
    '',
  ];

  for (const m of messages) {
    const time = new Date(m.created_at).toLocaleTimeString();
    const role = m.role.toUpperCase();

    if (m.role === 'tool_call') {
      lines.push(`[${time}] TOOL_CALL: ${m.tool_name}(${m.content.slice(0, 80)}${m.content.length > 80 ? '...' : ''})`);
    } else if (m.role === 'tool_result') {
      const status = m.tool_status ?? 'ok';
      lines.push(`[${time}] TOOL_RESULT (${m.tool_name}, ${status}): ${redactSensitiveText(m.content.slice(0, 150))}${m.content.length > 150 ? '...' : ''}`);
    } else {
      const content = redactSensitiveText(m.content);
      const truncated = content.length > 300 ? content.slice(0, 300) + '...' : content;
      lines.push(`[${time}] ${role}: ${truncated}`);
    }
  }

  return lines.join('\n');
}

function handleInfo(ctx: ToolContext, sessionId: string | undefined): string {
  if (!sessionId) return 'Error: session_id is required for info action.';

  const session = getSession(sessionId);
  if (!session) return `Error: Session not found: ${sessionId}`;
  if (session.user_id !== ctx.user_id) return 'Error: You can only view your own sessions.';

  return [
    `## Session Info`,
    `- ID: ${session.session_id}`,
    `- Title: ${session.title || 'Untitled'}`,
    `- Type: ${session.session_type}`,
    `- Engine: ${session.engine}`,
    `- Messages: ${session.message_count}`,
    `- Total tokens: ${session.total_tokens.toLocaleString()}`,
    `- Total cost: $${session.total_cost.toFixed(4)}`,
    session.parent_session_id ? `- Parent: ${session.parent_session_id}` : null,
    session.summary ? `- Summary: ${session.summary}` : null,
    `- Created: ${session.created_at}`,
    `- Updated: ${session.updated_at}`,
    session.archived_at ? `- Archived: ${session.archived_at}` : null,
  ].filter(Boolean).join('\n');
}

async function handleSpawn(ctx: ToolContext, input: Record<string, unknown>): Promise<string> {
  const task = input['task'] as string | undefined;
  if (!task) return 'Error: task is required for spawn action. Provide a clear task description.';

  const label = (input['label'] as string | undefined) ?? 'task';
  const timeoutSeconds = (input['timeout_seconds'] as number | undefined) ?? 120;

  const result = await spawnSubagent({
    task,
    label,
    timeoutSeconds,
    mode: 'run',
    parentSessionId: ctx.session_id,
    parentUserId: ctx.user_id,
  });

  // Announce result back to parent session
  if (result.sessionId) {
    await announceResult(ctx.session_id, result);
  }

  return JSON.stringify({
    status: result.status,
    session_id: result.sessionId,
    output_preview: result.output.slice(0, 2000),
    usage: result.usage,
  }, null, 2);
}

function formatAge(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
