// @jowork/core/audit — Audit logging for tracking system mutations
//
// Records who did what, when, and on which resource.
// Auto-records all non-GET API requests via middleware.

import { randomUUID } from 'node:crypto';
import { getDb } from '../datamap/db.js';

export interface AuditEntry {
  id: string;
  userId: string;
  action: string;        // HTTP method: POST, PATCH, PUT, DELETE
  resource: string;      // route path, e.g. /api/sessions/abc
  resourceType: string;  // inferred: sessions, connectors, memories, etc.
  statusCode: number;
  ip: string;
  userAgent: string;
  createdAt: string;
}

export interface RecordAuditInput {
  userId: string;
  action: string;
  resource: string;
  resourceType: string;
  statusCode: number;
  ip?: string;
  userAgent?: string;
}

/** Record an audit log entry. */
export function recordAudit(input: RecordAuditInput): AuditEntry {
  const db = getDb();
  const entry: AuditEntry = {
    id: randomUUID(),
    userId: input.userId,
    action: input.action,
    resource: input.resource,
    resourceType: input.resourceType,
    statusCode: input.statusCode,
    ip: input.ip ?? '',
    userAgent: input.userAgent ?? '',
    createdAt: new Date().toISOString(),
  };
  db.prepare(`
    INSERT INTO audit_log (id, user_id, action, resource, resource_type, status_code, ip, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(entry.id, entry.userId, entry.action, entry.resource, entry.resourceType, entry.statusCode, entry.ip, entry.userAgent, entry.createdAt);
  return entry;
}

/** Infer resource type from a request path. */
export function inferResourceType(path: string): string {
  // /api/sessions/... → sessions
  // /api/connectors/... → connectors
  const match = /^\/api\/([^/]+)/.exec(path);
  return match ? match[1]! : 'unknown';
}

export interface AuditQuery {
  userId?: string;
  action?: string;
  resourceType?: string;
  since?: string;       // ISO date
  until?: string;       // ISO date
  limit?: number;
  offset?: number;
}

export interface AuditQueryResult {
  entries: AuditEntry[];
  total: number;
}

/** Query audit log entries with filters. */
export function queryAuditLog(query: AuditQuery = {}): AuditQueryResult {
  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.userId) {
    conditions.push('user_id = ?');
    params.push(query.userId);
  }
  if (query.action) {
    conditions.push('action = ?');
    params.push(query.action);
  }
  if (query.resourceType) {
    conditions.push('resource_type = ?');
    params.push(query.resourceType);
  }
  if (query.since) {
    conditions.push('created_at >= ?');
    params.push(query.since);
  }
  if (query.until) {
    conditions.push('created_at <= ?');
    params.push(query.until);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;

  const countRow = db.prepare(`SELECT COUNT(*) AS total FROM audit_log ${where}`).get(...params) as { total: number };
  const rows = db.prepare(`SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as Array<{
    id: string; user_id: string; action: string; resource: string; resource_type: string;
    status_code: number; ip: string; user_agent: string; created_at: string;
  }>;

  return {
    total: countRow.total,
    entries: rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      action: r.action,
      resource: r.resource,
      resourceType: r.resource_type,
      statusCode: r.status_code,
      ip: r.ip,
      userAgent: r.user_agent,
      createdAt: r.created_at,
    })),
  };
}

/** Delete audit entries older than the given date (retention policy). */
export function purgeAuditBefore(before: string): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM audit_log WHERE created_at < ?`).run(before);
  return result.changes;
}
