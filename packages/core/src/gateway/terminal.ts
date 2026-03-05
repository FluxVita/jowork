import * as pty from 'node-pty';
import { createLogger } from '../utils/logger.js';

const log = createLogger('terminal');

export type TerminalMode = 'shell' | 'tmux' | 'klaude';

interface TerminalSession {
  id: string;
  p: pty.IPty;
  userId: string;
  createdAt: number;
  lastActivityAt: number;
}

const sessions = new Map<string, TerminalSession>();

function getDefaultShell(): string {
  if (process.platform === 'win32') return process.env['COMSPEC'] ?? 'cmd.exe';
  return process.env['SHELL'] ?? '/bin/zsh';
}

function resolveSpawn(mode: TerminalMode, tmuxSession?: string): { file: string; args: string[] } {
  if (mode === 'tmux') {
    return { file: 'tmux', args: ['new-session', '-A', '-s', tmuxSession || 'jowork'] };
  }
  // core/free: klaude 模式回退为普通 shell，保证基础终端可用
  return { file: getDefaultShell(), args: [] };
}

export function createSession(opts: {
  userId: string;
  mode?: TerminalMode;
  tmuxSession?: string;
  cols?: number;
  rows?: number;
}): { id: string; pty: pty.IPty } {
  const mode = opts.mode ?? 'shell';
  const { file, args } = resolveSpawn(mode, opts.tmuxSession);
  const id = `term_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const cleanEnv: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete cleanEnv['CLAUDECODE'];
  delete cleanEnv['CLAUDE_CODE_ENTRYPOINT'];

  const proc = pty.spawn(file, args, {
    name: 'xterm-256color',
    cols: opts.cols ?? 220,
    rows: opts.rows ?? 50,
    cwd: process.env['HOME'] ?? process.cwd(),
    env: { ...cleanEnv, TERM: 'xterm-256color' },
  });

  const now = Date.now();
  const session: TerminalSession = {
    id,
    p: proc,
    userId: opts.userId,
    createdAt: now,
    lastActivityAt: now,
  };
  sessions.set(id, session);

  proc.onData(() => {
    session.lastActivityAt = Date.now();
  });
  proc.onExit(() => {
    sessions.delete(id);
  });

  log.info('Terminal session created', { id, userId: opts.userId, mode, file });
  return { id, pty: proc };
}

export function getSession(id: string): { id: string; pty: pty.IPty } | null {
  const s = sessions.get(id);
  if (!s) return null;
  return { id: s.id, pty: s.p };
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s) return;
  try { s.p.resize(cols, rows); } catch { /* noop */ }
}

export function destroySession(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try { s.p.kill(); } catch { /* noop */ }
  sessions.delete(id);
}

// 清理 2 小时无活动会话
setInterval(() => {
  const now = Date.now();
  const idleLimit = 2 * 60 * 60 * 1000;
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastActivityAt > idleLimit) {
      destroySession(id);
      log.warn('Terminal session cleaned (idle)', { id, userId: s.userId });
    }
  }
}, 10 * 60 * 1000);
