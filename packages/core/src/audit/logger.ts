import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
import type { AuditEntry } from '../types.js';

export function logAudit(entry: Omit<AuditEntry, 'audit_id' | 'timestamp'>): string {
  const id = genId('aud');
  const now = new Date().toISOString();

  // 异步写入：audit log 不影响当前请求，延后到下一个事件循环执行
  setImmediate(() => {
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO audit_logs (audit_id, timestamp, actor_id, actor_role, channel, action,
          object_id, object_title, sensitivity, result, matched_rule, sources_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, now, entry.actor_id, entry.actor_role, entry.channel ?? null,
        entry.action, entry.object_id ?? null, entry.object_title ?? null,
        entry.sensitivity ?? null, entry.result, entry.matched_rule ?? null,
        entry.response_sources ? JSON.stringify(entry.response_sources) : null,
      );
    } catch { /* audit 写入失败不影响主流程 */ }
  });

  return id;
}

export function queryAuditLogs(opts: {
  actor_id?: string;
  action?: string;
  from?: string;
  to?: string;
  limit?: number;
}): AuditEntry[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (opts.actor_id) { conditions.push('actor_id = ?'); params.push(opts.actor_id); }
  if (opts.action) { conditions.push('action = ?'); params.push(opts.action); }
  if (opts.from) { conditions.push('timestamp >= ?'); params.push(opts.from); }
  if (opts.to) { conditions.push('timestamp <= ?'); params.push(opts.to); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;

  return db.prepare(
    `SELECT * FROM audit_logs ${where} ORDER BY timestamp DESC LIMIT ?`
  ).all(...params, limit) as AuditEntry[];
}
