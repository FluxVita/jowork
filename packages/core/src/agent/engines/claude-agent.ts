/**
 * agent/engines/claude-agent.ts — Free tier stub
 * 真实实现在 packages/premium/src/agent/engines/claude-agent.ts
 */
import type { AgentEngine, AgentEngineOpts, AgentEvent } from '../types.js';

export class ClaudeAgentEngine implements AgentEngine {
  readonly type = 'claude_agent' as const;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async *run(_opts: AgentEngineOpts): AsyncGenerator<AgentEvent> {
    yield { event: 'text_done', data: { content: 'Claude Agent Engine 需要 Premium 功能。' } };
  }
}
