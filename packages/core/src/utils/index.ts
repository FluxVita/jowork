// @jowork/core — utility functions

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';

// ─── ID generation ────────────────────────────────────────────────────────────

export function generateId(): string {
  return randomUUID();
}

// ─── Time ────────────────────────────────────────────────────────────────────

export function nowISO(): string {
  return new Date().toISOString();
}

// ─── Logger ──────────────────────────────────────────────────────────────────

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  const configured = (config.logLevel as LogLevel) ?? 'info';
  return LOG_LEVELS[level] >= LOG_LEVELS[configured];
}

function fmt(level: LogLevel, message: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const base = `[${ts}] ${level.toUpperCase()} ${message}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

export const logger = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('debug')) console.debug(fmt('debug', message, meta));
  },
  info(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('info')) console.info(fmt('info', message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('warn')) console.warn(fmt('warn', message, meta));
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('error')) console.error(fmt('error', message, meta));
  },
};

// ─── Misc ────────────────────────────────────────────────────────────────────

/** Safely parse JSON, returning undefined on failure */
export function safeJson<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/** Paginate an array */
export function paginate<T>(items: T[], page: number, limit: number): T[] {
  return items.slice((page - 1) * limit, page * limit);
}
