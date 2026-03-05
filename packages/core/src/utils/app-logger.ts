/**
 * 持久化应用日志写入器
 * warn/error 级别日志自动落库（app_logs 表），重启不丢失。
 * 可附加 user_id / session_id / request_path / duration_ms / context。
 */

import type { LogLevel } from './log-buffer.js';
// 使用 ESM live binding：函数体内调用时模块已完整初始化，循环依赖安全
import { getDb } from '../datamap/db.js';

export interface AppLogEntry {
  level: LogLevel;
  component: string;
  message: string;
  user_id?: string;
  session_id?: string;
  request_path?: string;
  duration_ms?: number;
  context?: Record<string, unknown>;
}

/** 写入 app_logs 表（异步，不阻塞主流程） */
export function writeAppLog(entry: AppLogEntry): void {
  // 延后到下一 tick，避免在 db 初始化完成前调用
  setImmediate(() => {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO app_logs (ts, level, component, message, user_id, session_id, request_path, duration_ms, context_json)
        VALUES (datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.level,
        entry.component,
        entry.message,
        entry.user_id ?? null,
        entry.session_id ?? null,
        entry.request_path ?? null,
        entry.duration_ms ?? null,
        entry.context ? JSON.stringify(entry.context) : null,
      );
    } catch { /* app_log 写入失败不影响主流程 */ }
  });
}

/** 查询 app_logs */
export interface QueryAppLogsOpts {
  level?: string;        // 'all' | 'warn' | 'error' | 'info'
  component?: string;
  user_id?: string;
  session_id?: string;
  from?: string;         // ISO date string
  to?: string;
  q?: string;            // 关键词
  limit?: number;
  offset?: number;
}

export interface AppLogRow {
  id: number;
  ts: string;
  level: string;
  component: string;
  message: string;
  user_id: string | null;
  session_id: string | null;
  request_path: string | null;
  duration_ms: number | null;
  context_json: string | null;
}

export function queryAppLogs(opts: QueryAppLogsOpts = {}): { rows: AppLogRow[]; total: number } {
  const db = getDb();

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.level && opts.level !== 'all') {
    if (opts.level === 'warn+') {
      conditions.push("level IN ('warn','error')");
    } else {
      conditions.push('level = ?'); params.push(opts.level);
    }
  }
  if (opts.component) { conditions.push('component LIKE ?'); params.push(`%${opts.component}%`); }
  if (opts.user_id)   { conditions.push('user_id = ?');     params.push(opts.user_id); }
  if (opts.session_id){ conditions.push('session_id = ?');  params.push(opts.session_id); }
  if (opts.from)      { conditions.push('ts >= ?');         params.push(opts.from); }
  if (opts.to)        { conditions.push('ts <= ?');         params.push(opts.to); }
  if (opts.q) {
    const lq = `%${opts.q}%`;
    conditions.push('(message LIKE ? OR component LIKE ?)');
    params.push(lq, lq);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit  = Math.min(opts.limit  ?? 200, 1000);
  const offset = opts.offset ?? 0;

  const total = (db.prepare(`SELECT COUNT(*) as n FROM app_logs ${where}`).get(...params) as { n: number }).n;
  const rows  = db.prepare(`SELECT * FROM app_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as AppLogRow[];

  return { rows, total };
}
