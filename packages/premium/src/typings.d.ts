// Type stubs for optional premium dependencies
// These packages are installed by the user separately — not required for compilation.

declare module '@anthropic-ai/claude-code-agent-sdk' {
  const sdk: unknown;
  export default sdk;
  export const Agent: unknown;
}

declare module 'node-pty' {
  export function spawn(
    shell: string,
    args: string[],
    options: {
      name?: string;
      cols?: number;
      rows?: number;
      cwd?: string;
      env?: Record<string, string>;
    },
  ): {
    write(data: string): void;
    onData(callback: (data: string) => void): void;
    resize(cols: number, rows: number): void;
    kill(): void;
  };
}
