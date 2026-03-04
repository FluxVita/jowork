// @jowork/premium/agent/engines/dispatcher — selects between builtin and premium engines

import { runBuiltin, getEdition } from '@jowork/core';
import type { RunOptions, RunResult } from '@jowork/core';
import { runClaudeAgent } from './claude-agent.js';

export type EngineId = 'builtin' | 'claude-agent';

/** Choose and run the appropriate engine based on edition and explicit override */
export async function dispatch(
  opts: RunOptions,
  engineOverride?: EngineId,
): Promise<RunResult> {
  const edition = getEdition();
  const availableEngines = edition.agentEngines as EngineId[];

  const engine = engineOverride ?? (availableEngines.includes('claude-agent') ? 'claude-agent' : 'builtin');

  if (engine === 'claude-agent' && availableEngines.includes('claude-agent')) {
    return runClaudeAgent(opts);
  }

  // Default to builtin engine
  return runBuiltin(opts);
}
