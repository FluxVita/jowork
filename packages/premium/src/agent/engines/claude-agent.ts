// @jowork/premium/agent/engines/claude-agent — Claude Agent SDK engine
// Requires: @anthropic-ai/claude-code-agent-sdk (installed separately by user)

import type { RunOptions, RunResult } from '@jowork/core';
import { generateId, nowISO, logger } from '@jowork/core';

/**
 * Run using the Claude Agent SDK engine.
 * Falls back to a descriptive error if the SDK is not installed.
 */
export async function runClaudeAgent(opts: RunOptions): Promise<RunResult> {
  logger.info('Claude Agent SDK engine started', { sessionId: opts.sessionId });

  // Attempt dynamic import of the Anthropic Agent SDK
  let AgentSDK: unknown;
  try {
    AgentSDK = await import('@anthropic-ai/claude-code-agent-sdk');
  } catch {
    throw new Error(
      'Claude Agent SDK is not installed. Run: npm install @anthropic-ai/claude-code-agent-sdk',
    );
  }

  // SDK interface is evolving — placeholder integration point
  // TODO: Wire up actual SDK call once interface stabilizes
  void AgentSDK;
  logger.warn('Claude Agent SDK integration is a placeholder — implement with actual SDK API');

  return {
    messages: [
      {
        id: generateId(),
        sessionId: opts.sessionId,
        role: 'user',
        content: opts.userMessage,
        createdAt: nowISO(),
      },
      {
        id: generateId(),
        sessionId: opts.sessionId,
        role: 'assistant',
        content: '[Claude Agent SDK engine — integration pending]',
        createdAt: nowISO(),
      },
    ],
    turnCount: 1,
  };
}
