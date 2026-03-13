import * as pty from 'node-pty';
import { createId } from '@jowork/core';
import * as fs from 'fs';

interface PtySession {
  id: string;
  process: pty.IPty;
}

const ALLOWED_SHELLS = new Set([
  '/bin/bash', '/bin/zsh', '/bin/sh', '/bin/fish',
  '/usr/bin/bash', '/usr/bin/zsh', '/usr/bin/fish',
  '/usr/local/bin/bash', '/usr/local/bin/zsh', '/usr/local/bin/fish',
  '/opt/homebrew/bin/bash', '/opt/homebrew/bin/zsh', '/opt/homebrew/bin/fish',
  'powershell.exe', 'cmd.exe',
]);

function resolveShell(requested?: string): string {
  const defaultShell = process.platform === 'win32'
    ? 'powershell.exe'
    : process.env.SHELL || '/bin/zsh';

  const shell = requested || defaultShell;

  // Windows shells don't need path validation
  if (process.platform === 'win32') return shell;

  // Resolve symlinks to get the real path
  let resolved = shell;
  try { resolved = fs.realpathSync(shell); } catch { /* use as-is */ }

  if (!ALLOWED_SHELLS.has(shell) && !ALLOWED_SHELLS.has(resolved)) {
    throw new Error(`Shell not allowed: ${shell}`);
  }

  return resolved;
}

export class PtyManager {
  private sessions = new Map<string, PtySession>();

  create(opts?: { cwd?: string; shell?: string }): string {
    const id = createId('pty');
    const shell = resolveShell(opts?.shell);

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
