import { pushLog, type LogLevel } from './log-buffer.js';
import { writeAppLog } from './app-logger.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: Level = (process.env['LOG_LEVEL'] as Level) || 'info';

// warn/error 以上自动持久化到 app_logs 表
const DB_PERSIST_LEVEL: Level = 'warn';

function log(level: Level, component: string, msg: string, data?: unknown) {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level.toUpperCase()}] [${component}]`;
  const dataStr = data !== undefined
    ? (typeof data === 'string' ? data : JSON.stringify(data))
    : undefined;
  const full = dataStr !== undefined ? `${msg} ${dataStr}` : msg;
  if (dataStr !== undefined) {
    console.log(prefix, msg, dataStr);
  } else {
    console.log(prefix, msg);
  }
  pushLog(level as LogLevel, component, full);

  // warn/error 自动持久化
  if (LEVELS[level] >= LEVELS[DB_PERSIST_LEVEL]) {
    writeAppLog({
      level: level as LogLevel,
      component,
      message: full,
    });
  }
}

export function createLogger(component: string) {
  return {
    debug: (msg: string, data?: unknown) => log('debug', component, msg, data),
    info:  (msg: string, data?: unknown) => log('info',  component, msg, data),
    warn:  (msg: string, data?: unknown) => log('warn',  component, msg, data),
    error: (msg: string, data?: unknown) => log('error', component, msg, data),
  };
}

/**
 * 带上下文的日志记录（用于关联 user_id / session_id）
 * 主要用于 agent、auth、API 路由中写入有归属信息的日志
 */
export function logWithContext(
  level: LogLevel,
  component: string,
  msg: string,
  ctx: { user_id?: string; session_id?: string; request_path?: string; duration_ms?: number; context?: Record<string, unknown> },
) {
  if (LEVELS[level] < LEVELS[currentLevel]) return;
  const full = ctx.context ? `${msg} ${JSON.stringify(ctx.context)}` : msg;
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}] [${component}]`, full);
  pushLog(level, component, full);
  // 始终写 DB（有上下文的日志全部持久化）
  writeAppLog({ level, component, message: full, ...ctx });
}
