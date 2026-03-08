import * as pty from 'node-pty';
import { existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { isWindows } from '../platform.js';

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

// PTY 会话上限
const MAX_SESSIONS_TOTAL = 50;
const MAX_SESSIONS_PER_USER = 5;

function getDefaultShell(): string {
  if (isWindows) {
    // 优先 PowerShell 7（pwsh），其次 Windows PowerShell 5（内置），最后 cmd
    const pwsh7 = `${process.env['PROGRAMFILES'] ?? 'C:\\Program Files'}\\PowerShell\\7\\pwsh.exe`;
    if (existsSync(pwsh7)) return pwsh7;
    const ps5 = `${process.env['SYSTEMROOT'] ?? 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    if (existsSync(ps5)) return ps5;
    return process.env['COMSPEC'] ?? 'cmd.exe';
  }
  return process.env['SHELL'] ?? '/bin/zsh';
}

function resolveSpawn(mode: TerminalMode, tmuxSession?: string): { file: string; args: string[] } {
  if (mode === 'tmux') {
    if (isWindows) {
      // tmux 在 Windows 上不可用，回退到默认 shell
      log.warn('tmux mode is not supported on Windows, falling back to shell');
      return { file: getDefaultShell(), args: [] };
    }
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

  // 全局上限
  if (sessions.size >= MAX_SESSIONS_TOTAL) {
    throw new Error(`PTY 会话已达全局上限 (${MAX_SESSIONS_TOTAL})，请关闭未使用的终端`);
  }
  // 每用户上限
  const userCount = [...sessions.values()].filter(s => s.userId === opts.userId).length;
  if (userCount >= MAX_SESSIONS_PER_USER) {
    throw new Error(`当前用户 PTY 会话已达上限 (${MAX_SESSIONS_PER_USER})，请关闭未使用的终端`);
  }

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
    env: { ...cleanEnv, TERM: 'xterm-256color', TERM_PROGRAM: 'jowork' },
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

// 每 5 分钟清理空闲超过 30 分钟的会话（防 PTY 泄漏）
setInterval(() => {
  const now = Date.now();
  const idleLimit = 30 * 60 * 1000; // 30 分钟
  for (const [id, s] of sessions.entries()) {
    if (now - s.lastActivityAt > idleLimit) {
      destroySession(id);
      log.warn('Terminal session cleaned (idle >30min)', { id, userId: s.userId });
    }
  }
}, 5 * 60 * 1000);
