import { pino } from 'pino';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

function getLogDir(): string {
  const dir = join(process.env['HOME'] ?? '/tmp', '.jowork', 'logs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

// Use stderr for logs so stdout stays clean for MCP stdio transport
export const logger = pino({
  level: process.env['LOG_LEVEL'] ?? 'info',
  redact: {
    paths: ['*.secret', '*.token', '*.appSecret', '*.apiKey', '*.password', '*.credential'],
    censor: '***REDACTED***',
  },
  transport: process.env['JOWORK_LOG_FILE']
    ? { target: 'pino/file', options: { destination: join(getLogDir(), 'jowork.log') } }
    : { target: 'pino-pretty', options: { destination: 2 } }, // stderr
});

// Sanitize arbitrary strings before logging (for free-form content)
const SENSITIVE_PATTERNS = [
  /(?:token|secret|key|password|credential)[\s=:]+\S+/gi,
  /Bearer\s+\S+/gi,
  /npm_[a-zA-Z0-9]+/gi,
];

export function sanitizeForLog(str: string): string {
  let result = str;
  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, (match) => {
      const spaceIdx = match.indexOf(' ');
      return match.slice(0, (spaceIdx !== -1 ? spaceIdx + 1 : 10)) + '***';
    });
  }
  return result;
}

// Convenience methods matching desktop logger interface
export function logInfo(category: string, msg: string, ctx?: Record<string, unknown>): void {
  logger.info({ category, ...ctx }, msg);
}

export function logError(category: string, msg: string, ctx?: Record<string, unknown>): void {
  logger.error({ category, ...ctx }, msg);
}

export function logWarn(category: string, msg: string, ctx?: Record<string, unknown>): void {
  logger.warn({ category, ...ctx }, msg);
}
