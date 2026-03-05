import { pushLog, type LogLevel } from './log-buffer.js';

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
type Level = keyof typeof LEVELS;

const currentLevel: Level = (process.env['LOG_LEVEL'] as Level) || 'info';

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
}

export function createLogger(component: string) {
  return {
    debug: (msg: string, data?: unknown) => log('debug', component, msg, data),
    info: (msg: string, data?: unknown) => log('info', component, msg, data),
    warn: (msg: string, data?: unknown) => log('warn', component, msg, data),
    error: (msg: string, data?: unknown) => log('error', component, msg, data),
  };
}
