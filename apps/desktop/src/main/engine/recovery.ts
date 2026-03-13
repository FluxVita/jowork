import type { AgentEngine, EngineId } from './types';
import { BrowserWindow } from 'electron';

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 10000]; // escalating retry delays

export class EngineRecovery {
  private retryCounts = new Map<string, number>();

  watchProcess(engine: AgentEngine): void {
    if (!engine.process) return;

    engine.process.on('exit', (code, signal) => {
      if (code !== 0 && code !== null) {
        this.handleCrash(engine.id, code, signal);
      }
    });
  }

  /** Get the first live BrowserWindow, or null. */
  private getLiveWindow(): BrowserWindow | null {
    return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
  }

  private handleCrash(engineId: EngineId, code: number, signal: string | null): void {
    const retries = this.retryCounts.get(engineId) ?? 0;

    // Notify renderer
    this.getLiveWindow()?.webContents.send('engine:crashed', { engineId, code, signal, retries });

    if (retries >= MAX_RETRIES) {
      this.retryCounts.delete(engineId);
      this.getLiveWindow()?.webContents.send('engine:crash-fatal', {
        engineId,
        message: `Engine ${engineId} failed after ${MAX_RETRIES} restart attempts.`,
      });
      return;
    }

    this.retryCounts.set(engineId, retries + 1);

    // The actual restart is handled by EngineManager when the next chat() call is made.
    // Recovery just tracks retry state and notifies the UI.
    setTimeout(() => {
      this.getLiveWindow()?.webContents.send('engine:restart-ready', { engineId });
    }, RETRY_DELAYS[retries]);
  }

  resetRetries(engineId: EngineId): void {
    this.retryCounts.delete(engineId);
  }

  getRetryCount(engineId: EngineId): number {
    return this.retryCounts.get(engineId) ?? 0;
  }
}
