import { spawn, type ChildProcess } from 'child_process';
import type { AgentEngine, EngineEvent, ChatOpts, InstallStatus } from './types';

/**
 * Claude Code local engine adapter.
 *
 * Primary: Claude Agent SDK `query()` (when available)
 * Fallback: CLI subprocess with `--output-format stream-json`
 */
export class ClaudeCodeEngine implements AgentEngine {
  readonly id = 'claude-code' as const;
  readonly type = 'local' as const;
  process?: ChildProcess;
  private abortController?: AbortController;

  async checkInstalled(): Promise<InstallStatus> {
    try {
      const version = await this.runCommand('claude', ['--version']);
      return { installed: true, version: version.trim() };
    } catch {
      return { installed: false, error: 'Claude Code CLI not found' };
    }
  }

  async install(): Promise<void> {
    await this.runCommand('npm', ['install', '-g', '@anthropic-ai/claude-code']);
  }

  async *chat(opts: ChatOpts): AsyncGenerator<EngineEvent> {
    this.abortController = new AbortController();

    const args = [
      '-p', opts.message,
      '--output-format', 'stream-json',
    ];
    if (opts.systemContext) {
      args.push('--system-prompt', opts.systemContext);
    }
    if (opts.cwd) {
      args.push('--cwd', opts.cwd);
    }
    // resume support: engineSessionId is resolved by HistoryManager before calling chat
    if (opts.sessionId) {
      args.push('--resume', opts.sessionId);
    }

    const child = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: this.abortController.signal,
      env: { ...process.env, CLAUDECODE: undefined },
    });
    this.process = child;

    let buffer = '';

    try {
      for await (const chunk of child.stdout!) {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            yield this.mapToEngineEvent(event);
          } catch {
            // skip non-JSON lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          yield this.mapToEngineEvent(event);
        } catch {
          // ignore
        }
      }

      yield { type: 'done' };
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        yield { type: 'done' };
      } else {
        yield { type: 'error', message: String(err) } as EngineEvent & { message: string };
      }
    } finally {
      this.process = undefined;
    }
  }

  async abort(): Promise<void> {
    this.abortController?.abort();
    if (this.process && !this.process.killed) {
      this.process.kill('SIGTERM');
    }
  }

  private mapToEngineEvent(raw: Record<string, unknown>): EngineEvent {
    // Claude Code stream-json output format mapping
    const type = raw.type as string;

    switch (type) {
      case 'system':
        return { type: 'system' };
      case 'assistant':
        if (raw.subtype === 'thinking') {
          return { type: 'thinking', content: (raw.content as string) ?? '' };
        }
        return { type: 'text', content: (raw.content as string) ?? (raw.message as string) ?? '' };
      case 'result':
        return { type: 'usage', content: JSON.stringify(raw.usage ?? raw) };
      default:
        return { type: 'text', content: (raw.content as string) ?? (raw.message as string) ?? '' };
    }
  }

  private runCommand(cmd: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d));
      child.stderr?.on('data', (d) => (stderr += d));
      child.on('close', (code) => {
        if (code === 0) resolve(stdout);
        else reject(new Error(stderr || `Command failed with code ${code}`));
      });
      child.on('error', reject);
    });
  }
}
