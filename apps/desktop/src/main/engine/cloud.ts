import type { AgentEngine, EngineEvent, ChatOpts, InstallStatus } from './types';

/**
 * Cloud Engine adapter — placeholder until Phase 6.
 * Phase 1-5: returns "not available" message.
 * Phase 6+: POST to JoWork Cloud API with SSE streaming.
 */
export class CloudEngine implements AgentEngine {
  readonly id = 'jowork-cloud' as const;
  readonly type = 'cloud' as const;

  async checkInstalled(): Promise<InstallStatus> {
    return {
      installed: false,
      error: 'Cloud Engine will be available in a future update. Use a local engine for now.',
    };
  }

  async *chat(_opts: ChatOpts): AsyncGenerator<EngineEvent> {
    yield { type: 'system' };
    yield { type: 'text' };
    yield { type: 'done' };
  }

  async abort(): Promise<void> {
    // no-op for placeholder
  }
}
