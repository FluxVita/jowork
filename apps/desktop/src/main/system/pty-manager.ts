import * as pty from 'node-pty';
import { createId } from '@jowork/core';

interface PtySession {
  id: string;
  process: pty.IPty;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();

  create(opts?: { cwd?: string; shell?: string }): string {
    const id = createId('pty');
    const shell =
      opts?.shell ||
      (process.platform === 'win32'
        ? 'powershell.exe'
        : process.env.SHELL || '/bin/zsh');

    // Clean environment to avoid nested process issues
    const env = { ...process.env } as Record<string, string>;
    delete env.CLAUDE_CODE;
    delete env.CLAUDECODE;
    delete env.TMUX;

    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: opts?.cwd || process.env.HOME || '/',
      env,
    });

    this.sessions.set(id, { id, process: ptyProcess });
    return id;
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.process.write(data);
  }

  resize(id: string, cols: number, rows: number): void {
    this.sessions.get(id)?.process.resize(cols, rows);
  }

  onData(id: string, callback: (data: string) => void): void {
    this.sessions.get(id)?.process.onData(callback);
  }

  onExit(id: string, callback: (exitCode: number, signal?: number) => void): void {
    this.sessions.get(id)?.process.onExit(({ exitCode, signal }) => {
      callback(exitCode, signal);
      this.sessions.delete(id);
    });
  }

  destroy(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.kill();
      this.sessions.delete(id);
    }
  }

  destroyAll(): void {
    for (const [id] of this.sessions) {
      this.destroy(id);
    }
  }

  list(): string[] {
    return Array.from(this.sessions.keys());
  }
}
