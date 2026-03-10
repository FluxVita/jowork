/**
 * agent/subagent/announce.ts — Phase 4.2: Announce Mechanism
 *
 * Sub-agent 完成后，将结果注入父 session 的消息历史。
 */
import { appendMessage } from '../session.js';
import type { SubagentResult } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('subagent-announce');

/**
 * 将 sub-agent 结果注入父 session
 */
export async function announceResult(
  parentSessionId: string,
  result: SubagentResult,
): Promise<void> {
  const message = formatAnnounce(result);

  // 注入到父 session 的消息历史（作为 tool_result）
  appendMessage({
    session_id: parentSessionId,
    role: 'tool_result',
    content: message,
    tool_name: 'sessions',
    tool_status: result.status === 'success' ? 'success' : 'error',
  });

  log.info(`Announced sub-agent result to parent ${parentSessionId} (${result.status})`);
}

function formatAnnounce(result: SubagentResult): string {
  const lines = [
    `## Sub-agent Result`,
    `- Status: ${result.status}`,
    `- Session: ${result.sessionId}`,
    `- Usage: ${result.usage.tokens_in + result.usage.tokens_out} tokens ($${result.usage.cost_usd.toFixed(4)})`,
    '',
    '### Output',
    result.output,
  ];

  return lines.join('\n');
}
