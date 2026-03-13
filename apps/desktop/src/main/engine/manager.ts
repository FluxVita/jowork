import { app } from 'electron';
import { join } from 'path';
import type { AgentEngine, EngineId, InstallStatus, EngineEvent, ChatOpts } from './types';
import { ClaudeCodeEngine } from './claude-code';
import { CloudEngine } from './cloud';
import { HistoryManager } from './history';
import { EngineRecovery } from './recovery';

export class EngineManager {
  private engines = new Map<EngineId, AgentEngine>();
  private activeEngineId: EngineId = 'claude-code';
  private historyManager: HistoryManager;
  private recovery: EngineRecovery;
  private cloudEngine: CloudEngine;

  constructor() {
    const dbPath = join(app.getPath('userData'), 'jowork.db');
    this.historyManager = new HistoryManager(dbPath);
    this.recovery = new EngineRecovery();

    // Register available engines
    this.engines.set('claude-code', new ClaudeCodeEngine());
    this.cloudEngine = new CloudEngine();
    this.engines.set('jowork-cloud', this.cloudEngine);
  }

  getHistoryManager(): HistoryManager {
    return this.historyManager;
  }

  getActiveEngineId(): EngineId {
    return this.activeEngineId;
  }

  configureCloudEngine(opts?: { apiUrl?: string; getToken?: () => string | null }): void {
    this.cloudEngine.updateConfig(opts);
  }

  async detectEngines(): Promise<Map<EngineId, InstallStatus>> {
    const results = new Map<EngineId, InstallStatus>();

    for (const [id, engine] of this.engines) {
      const status = await engine.checkInstalled();
      results.set(id, status);
    }

    return results;
  }

  async switchEngine(id: EngineId): Promise<void> {
    const engine = this.engines.get(id);
    if (!engine) throw new Error(`Unknown engine: ${id}`);

    const status = await engine.checkInstalled();
    if (!status.installed) {
      throw new Error(`Engine ${id} is not installed: ${status.error}`);
    }

    this.activeEngineId = id;
  }

  async *chat(opts: ChatOpts): AsyncGenerator<EngineEvent> {
    const engine = this.engines.get(this.activeEngineId);
    if (!engine) throw new Error(`No active engine`);

    // Resolve engine-side session ID if resuming
    let engineChatOpts = { ...opts };
    if (opts.sessionId) {
      const engineSessionId = this.historyManager.getEngineSessionId(
        opts.sessionId,
        this.activeEngineId,
      );
      if (engineSessionId) {
        engineChatOpts = { ...opts, sessionId: engineSessionId };
      }
    }

    // Watch process for crash recovery
    const stream = engine.chat(engineChatOpts);

    if (engine.process) {
      this.recovery.watchProcess(engine);
    }

    for await (const event of stream) {
      yield event;
    }

    // Reset retry count on successful completion
    this.recovery.resetRetries(this.activeEngineId);
  }

  async abort(): Promise<void> {
    const engine = this.engines.get(this.activeEngineId);
    if (engine) {
      await engine.abort();
    }
  }

  async installEngine(id: EngineId): Promise<void> {
    const engine = this.engines.get(id);
    if (!engine?.install) {
      throw new Error(`Engine ${id} does not support installation`);
    }
    await engine.install();
  }

  close(): void {
    this.historyManager.close();
  }
}
