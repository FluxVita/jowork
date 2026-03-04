// @jowork/premium/terminal/geek-mode — interactive terminal (node-pty)
// Requires: node-pty (installed separately: npm install node-pty)

export interface TerminalSession {
  id: string;
  write(data: string): void;
  onData(callback: (data: string) => void): void;
  resize(cols: number, rows: number): void;
  kill(): void;
}

/**
 * Create a PTY terminal session.
 * Throws if node-pty is not installed.
 */
export async function createTerminal(shell = process.env['SHELL'] ?? 'bash'): Promise<TerminalSession> {
  let pty: { spawn: (shell: string, args: string[], opts: object) => unknown };
  try {
    pty = (await import('node-pty')) as typeof pty;
  } catch {
    throw new Error('node-pty is not installed. Run: npm install node-pty');
  }

  const id = Math.random().toString(36).slice(2);
  const term = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env: process.env as Record<string, string>,
  }) as {
    write(data: string): void;
    onData(cb: (data: string) => void): void;
    resize(cols: number, rows: number): void;
    kill(): void;
  };

  return {
    id,
    write: (data) => term.write(data),
    onData: (cb) => term.onData(cb),
    resize: (cols, rows) => term.resize(cols, rows),
    kill: () => term.kill(),
  };
}
