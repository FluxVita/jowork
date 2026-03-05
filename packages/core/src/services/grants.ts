import { getDb } from '../datamap/db.js';
import { genId } from '../utils/id.js';
import { createLogger } from '../utils/logger.js';
import type { ServiceGrant, GrantType } from '../types.js';

const log = createLogger('svc-grants');

interface GrantRow {
  grant_id: string;
  service_id: string;
  grant_type: string;
  grant_target: string;
  granted_by: string;
  expires_at: string | null;
  created_at: string;
}

function rowToGrant(row: GrantRow): ServiceGrant {
  return {
    grant_id: row.grant_id,
    service_id: row.service_id,
    grant_type: row.grant_type as GrantType,
    grant_target: row.grant_target,
    granted_by: row.granted_by,
    expires_at: row.expires_at ?? undefined,
    created_at: row.created_at,
  };
}

/** 授予服务权限 */
export function grantService(
  serviceId: string,
  grantType: GrantType,
  target: string,
  grantedBy: string,
  expiresAt?: string,
): ServiceGrant {
  const db = getDb();
  const grantId = genId('grt');

  db.prepare(`
    INSERT OR REPLACE INTO service_grants (grant_id, service_id, grant_type, grant_target, granted_by, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(grantId, serviceId, grantType, target, grantedBy, expiresAt ?? null);

  log.info('Grant created', { serviceId, grantType, target });
  return {
    grant_id: grantId,
    service_id: serviceId,
    grant_type: grantType,
    grant_target: target,
    granted_by: grantedBy,
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
  };
}

/** 撤销授权 */
export function revokeGrant(grantId: string): void {
  const db = getDb();
  db.prepare('DELETE FROM service_grants WHERE grant_id = ?').run(grantId);
  log.info('Grant revoked', grantId);
}

/** 获取服务的所有授权 */
export function getGrantsForService(serviceId: string): ServiceGrant[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM service_grants WHERE service_id = ? ORDER BY created_at DESC').all(serviceId) as GrantRow[];
  return rows.map(rowToGrant);
}

/** 获取某类型/目标的所有授权 */
export function getGrantsForTarget(grantType: GrantType, target: string): ServiceGrant[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM service_grants WHERE grant_type = ? AND grant_target = ?').all(grantType, target) as GrantRow[];
  return rows.map(rowToGrant);
}
