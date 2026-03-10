import { getMessages } from './session.js';
import { getSession } from './session.js';

/**
 * 导出 session 为 JSONL 格式
 *
 * 兼容 OpenClaw 的 session transcript 格式，用途：
 * 1. Agent 自省（通过 fs_read 读取自己的对话历史）
 * 2. 备份/迁移
 * 3. 调试
 *
 * 每行一个 JSON record，格式:
 * {"type":"session_meta","session_id":"...","user_id":"...","title":"...","created_at":"..."}
 * {"type":"message","role":"user","content":"...","created_at":"..."}
 * {"type":"message","role":"assistant","content":"...","model":"...","tokens":...,"cost_usd":...}
 * {"type":"tool_call","name":"...","input":{...},"call_id":"..."}
 * {"type":"tool_result","name":"...","result":"...","status":"...","duration_ms":...}
 */
export function exportSessionToJsonl(sessionId: string): string | null {
  const session = getSession(sessionId);
  if (!session) return null;

  const lines: string[] = [];

  // Session metadata
  lines.push(JSON.stringify({
    type: 'session_meta',
    session_id: session.session_id,
    user_id: session.user_id,
    title: session.title,
    engine: session.engine,
    session_type: session.session_type,
    parent_session_id: session.parent_session_id,
    message_count: session.message_count,
    total_tokens: session.total_tokens,
    total_cost: session.total_cost,
    created_at: session.created_at,
    updated_at: session.updated_at,
  }));

  // Messages
  const messages = getMessages(sessionId, { limit: 10000 });
  for (const msg of messages) {
    if (msg.role === 'tool_call') {
      let input: Record<string, unknown> = {};
      try { input = JSON.parse(msg.content); } catch { /* keep empty */ }
      lines.push(JSON.stringify({
        type: 'tool_call',
        name: msg.tool_name,
        input,
        call_id: msg.tool_call_id,
        created_at: msg.created_at,
      }));
    } else if (msg.role === 'tool_result') {
      lines.push(JSON.stringify({
        type: 'tool_result',
        name: msg.tool_name,
        result: msg.content.length > 2000 ? msg.content.slice(0, 2000) + '…[truncated]' : msg.content,
        status: msg.tool_status,
        duration_ms: msg.duration_ms,
        created_at: msg.created_at,
      }));
    } else {
      lines.push(JSON.stringify({
        type: 'message',
        role: msg.role,
        content: msg.content,
        model: msg.model,
        provider: msg.provider,
        tokens: msg.tokens,
        cost_usd: msg.cost_usd,
        created_at: msg.created_at,
      }));
    }
  }

  return lines.join('\n') + '\n';
}
