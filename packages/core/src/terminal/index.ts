// @jowork/core/terminal — Basic shell command execution (Geek Mode)
//
// Provides stateful terminal sessions: each session tracks its working
// directory so `cd` commands persist across exec calls.
//
// Security note: intended for personal mode (single-user, local access only).
// Do not expose in multi-user/public deployments without additional auth.

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

const execAsync = promisify(exec);

/** Maximum output size per command (50 KB) to prevent memory issues */
const MAX_OUTPUT_BYTES = 50 * 1024;

/** Default command timeout in milliseconds */
const DEFAULT_TIMEOUT_MS = 30_000;

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
}

export interface TerminalSession {
  id: string;
  cwd: string;
  createdAt: string;
}

// In-memory session store (process lifetime only; no persistence needed)
const sessions = new Map<string, TerminalSession>();

function defaultCwd(): string {
  return homedir();
}

function getOrCreateSession(sessionId: string): TerminalSession {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { id: sessionId, cwd: defaultCwd(), createdAt: new Date().toISOString() };
    sessions.set(sessionId, session);
  }
  return session;
}

/**
 * Extract the working directory after executing a command.
 * We append `; echo "CWD:$(pwd)"` to capture the final directory,
 * which handles `cd` and compound commands correctly.
 */
function wrapWithCwdCapture(command: string): string {
  // Use a unique sentinel to find the CWD line in output
  return `${command}; echo "__CWD_CAPTURE__:$(pwd)"`;
}

function parseCwdFromOutput(raw: string, fallback: string): { output: string; cwd: string } {
  const lines = raw.split('\n');
  let cwd = fallback;
  const filtered: string[] = [];

  for (const line of lines) {
    if (line.startsWith('__CWD_CAPTURE__:')) {
      const candidate = line.slice('__CWD_CAPTURE__:'.length).trim();
      if (candidate && existsSync(candidate)) {
        cwd = candidate;
      }
    } else {
      filtered.push(line);
    }
  }

  return { output: filtered.join('\n'), cwd };
}

function truncate(s: string): string {
  const bytes = Buffer.byteLength(s, 'utf8');
  if (bytes <= MAX_OUTPUT_BYTES) return s;
  const truncated = Buffer.from(s, 'utf8').slice(0, MAX_OUTPUT_BYTES).toString('utf8');
  return truncated + '\n[... output truncated ...]';
}

/**
 * Execute a shell command within a terminal session.
 * The session's working directory is updated after the command runs.
 */
export async function execInSession(
  sessionId: string,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<ExecResult> {
  const session = getOrCreateSession(sessionId);
  const wrapped = wrapWithCwdCapture(command);

  try {
    const { stdout, stderr } = await execAsync(wrapped, {
      cwd: session.cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_OUTPUT_BYTES * 2,
      shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
    });

    const { output: cleanStdout, cwd: newCwd } = parseCwdFromOutput(stdout, session.cwd);
    session.cwd = newCwd;

    return {
      stdout: truncate(cleanStdout),
      stderr: truncate(stderr),
      exitCode: 0,
      cwd: session.cwd,
    };
  } catch (err: unknown) {
    // execAsync throws when exit code != 0 or timeout occurs
    const e = err as { stdout?: string; stderr?: string; code?: number; killed?: boolean; signal?: string };

    if (e.killed) {
      return {
        stdout: truncate(e.stdout ?? ''),
        stderr: `Command timed out after ${timeoutMs}ms`,
        exitCode: 124,
        cwd: session.cwd,
      };
    }

    const { output: cleanStdout, cwd: newCwd } = parseCwdFromOutput(e.stdout ?? '', session.cwd);
    session.cwd = newCwd;

    return {
      stdout: truncate(cleanStdout),
      stderr: truncate(e.stderr ?? String(err)),
      exitCode: typeof e.code === 'number' ? e.code : 1,
      cwd: session.cwd,
    };
  }
}

/** Get info about a terminal session (or create one with defaults) */
export function getSessionInfo(sessionId: string): TerminalSession {
  return getOrCreateSession(sessionId);
}

/** Reset a session's working directory to home */
export function resetSession(sessionId: string): TerminalSession {
  const session = getOrCreateSession(sessionId);
  session.cwd = defaultCwd();
  return session;
}

/** List all active terminal sessions */
export function listSessions(): TerminalSession[] {
  return Array.from(sessions.values());
}

/** Remove a session (kill it) */
export function removeSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}
