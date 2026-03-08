/**
 * PTY 会话管理 — VSCode 风格持久化
 *
 * 核心设计：PTY 生命周期与 WebSocket 连接生命周期解耦。
 *
 * 状态机：
 *   attached  — 有 WebSocket 在消费 PTY 输出
 *   detached  — WebSocket 断开，PTY 继续运行，输出写入 ring buffer
 *
 * 重连流程：
 *   前端携带 resumeId → reattachSession → 回放 ring buffer → 继续
 *
 * 清理策略：
 *   - detached 超过 1 小时 → 销毁（真正的孤儿）
 *   - attached 从不按时间强杀（用户正在用）
 */

import * as pty from 'node-pty';
import { existsSync } from 'node:fs';
import { createLogger } from '../utils/logger.js';
import { isWindows } from '../platform.js';

const log = createLogger('terminal');

export type TerminalMode = 'shell' | 'tmux' | 'klaude';

export interface TerminalSession {
  id: string;
  pty: pty.IPty;
  userId: string;
  mode: TerminalMode;
  createdAt: number;
  lastActivityAt: number;
  state: 'attached' | 'detached';
  detachedAt: number | null;
  // ring buffer：PTY 输出的最近 N 字节，重连后回放给用户
  outputBuffer: string;
  // 当前消费者的 send 回调（null = detached）
  attachedSend: ((chunk: string) => void) | null;
  // 当前 WS 连接注册的 onExit 监听器（重连时先 dispose 旧的再注册新的，防泄漏）
  wsExitDisposable: { dispose(): void } | null;
}

const sessions = new Map<string, TerminalSession>();

// ─── 配置 ───
const MAX_BUFFER_CHARS = 100_000;  // 每个会话最多缓存 ~100KB 输出
const DETACHED_TTL     = 60 * 60_000;  // 1 小时无人重连 → 销毁
const CLEANUP_INTERVAL = 5 * 60_000;   // 每 5 分钟清一次孤儿

// 安全网上限（防极端情况下内存耗尽，不是主要防护手段）
const MAX_SESSIONS_TOTAL    = 200;
const MAX_SESSIONS_PER_USER = 20;

// ─── Shell 解析 ───
function getDefaultShell(): string {
  if (isWindows) {
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
      log.warn('tmux mode is not supported on Windows, falling back to shell');
      return { file: getDefaultShell(), args: [] };
    }
    return { file: 'tmux', args: ['new-session', '-A', '-s', tmuxSession || 'jowork'] };
  }
  return { file: getDefaultShell(), args: [] };
}

// ─── 创建会话 ───
export function createSession(opts: {
  userId: string;
  mode?: TerminalMode;
  tmuxSession?: string;
  cols?: number;
  rows?: number;
  sendFn?: (chunk: string) => void;
}): TerminalSession {
  const mode = opts.mode ?? 'shell';

  // 安全网检查
  if (sessions.size >= MAX_SESSIONS_TOTAL) {
    throw new Error(`PTY 会话已达全局上限 (${MAX_SESSIONS_TOTAL})`);
  }
  const userCount = [...sessions.values()].filter(s => s.userId === opts.userId).length;
  if (userCount >= MAX_SESSIONS_PER_USER) {
    throw new Error(`当前用户 PTY 会话已达上限 (${MAX_SESSIONS_PER_USER})`);
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
    pty: proc,
    userId: opts.userId,
    mode,
    createdAt: now,
    lastActivityAt: now,
    state: 'attached',
    detachedAt: null,
    outputBuffer: '',
    attachedSend: opts.sendFn ?? null,
    wsExitDisposable: null,
  };
  sessions.set(id, session);

  // 内部 onData：始终更新活跃时间、写 ring buffer、转发给当前消费者
  proc.onData((chunk) => {
    session.lastActivityAt = Date.now();
    session.outputBuffer += chunk;
    if (session.outputBuffer.length > MAX_BUFFER_CHARS) {
      // 保留后半段（最新输出）
      session.outputBuffer = session.outputBuffer.slice(-MAX_BUFFER_CHARS);
    }
    if (session.attachedSend) {
      try { session.attachedSend(chunk); }
      catch { session.attachedSend = null; }
    }
  });

  proc.onExit(() => {
    sessions.delete(id);
    log.info('PTY process exited', { id, userId: opts.userId });
  });

  log.info('PTY session created', { id, userId: opts.userId, mode, file });
  return session;
}

// ─── 重连：将 WebSocket 重新挂载到已有的 PTY ───
export function reattachSession(
  id: string,
  userId: string,
  sendFn: (chunk: string) => void,
): { session: TerminalSession; bufferedOutput: string } | null {
  const session = sessions.get(id);
  if (!session) return null;
  // 安全：只允许同一用户重连
  if (session.userId !== userId) return null;

  const bufferedOutput = session.outputBuffer;
  session.state = 'attached';
  session.detachedAt = null;
  session.attachedSend = sendFn;

  log.info('PTY session reattached', { id, userId, bufferedBytes: bufferedOutput.length });
  return { session, bufferedOutput };
}

// ─── 断开：WebSocket 关闭时调用，PTY 继续运行 ───
export function detachSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  session.state = 'detached';
  session.detachedAt = Date.now();
  session.attachedSend = null;
  log.info('PTY session detached (PTY still running)', { id, userId: session.userId });
}

// ─── 主动销毁（用户手动关闭终端 Tab）───
export function destroySession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  try { session.pty.kill(); } catch { /* already dead */ }
  sessions.delete(id);
  log.info('PTY session destroyed', { id });
}

// ─── 其他工具 ───
export function getSession(id: string): TerminalSession | undefined {
  return sessions.get(id);
}

export function resizeSession(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s) return;
  try { s.pty.resize(cols, rows); } catch { /* ignore */ }
}

/**
 * 注册（或替换）当前 WS 连接的 onExit 回调。
 * 每次重连时调用此函数，自动 dispose 上一次注册的监听器，防止多次重连后监听器累积泄漏。
 */
export function setWsExitHandler(id: string, handler: () => void): void {
  const session = sessions.get(id);
  if (!session) return;
  // 先销毁旧的监听器
  if (session.wsExitDisposable) {
    session.wsExitDisposable.dispose();
  }
  session.wsExitDisposable = session.pty.onExit(handler);
}

export function listSessions(): { id: string; userId: string; mode: string; state: string; createdAt: number }[] {
  return [...sessions.values()].map(s => ({
    id: s.id,
    userId: s.userId,
    mode: s.mode,
    state: s.state,
    createdAt: s.createdAt,
  }));
}

// ─── 定期清理真正的孤儿（detached 超过 1 小时）───
setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions.entries()) {
    if (s.state === 'detached' && s.detachedAt !== null && now - s.detachedAt > DETACHED_TTL) {
      log.warn('PTY session expired (detached >1h), destroying', { id, userId: s.userId });
      destroySession(id);
    }
  }
}, CLEANUP_INTERVAL);
