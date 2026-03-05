/**
 * 内存日志缓冲区
 * 由 logger.ts 写入，API 读取供前端展示。
 * 环形缓冲：最多保留 MAX_ENTRIES 条，超出自动丢弃最旧的。
 */

const MAX_ENTRIES = 1000;

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  id: number;
  ts: string;
  level: LogLevel;
  component: string;
  message: string;
}

let seq = 0;
const buffer: LogEntry[] = [];

export function pushLog(level: LogLevel, component: string, message: string): void {
  buffer.push({ id: ++seq, ts: new Date().toISOString(), level, component, message });
  if (buffer.length > MAX_ENTRIES) buffer.shift();
}

export interface GetLogsOpts {
  level?: string;   // 'all' | 'info' | 'warn' | 'error'
  q?: string;       // 关键词搜索
  limit?: number;   // 默认 300
  after?: number;   // 仅返回 id > after 的条目（增量拉取）
}

export function getLogs(opts: GetLogsOpts = {}): LogEntry[] {
  const { level, q, limit = 300, after } = opts;

  let result = buffer as LogEntry[];

  if (after !== undefined) {
    result = result.filter(e => e.id > after);
  }
  if (level && level !== 'all') {
    result = result.filter(e => e.level === level);
  }
  if (q) {
    const lq = q.toLowerCase();
    result = result.filter(e =>
      e.message.toLowerCase().includes(lq) ||
      e.component.toLowerCase().includes(lq)
    );
  }

  return result.slice(-limit);
}
