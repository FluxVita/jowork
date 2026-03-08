import { getDb } from './db.js';

export interface UserIdMapping {
  canonical_id: string;
  posthog_person_id?: string | null;
  jovida_uid?: string | null;
  sls_user_id?: string | null;
  email?: string | null;
  device_id?: string | null;
  updated_at?: string;
}

export function upsertUserIdMapping(mapping: UserIdMapping): void {
  const db = getDb();
  db.prepare(`
    INSERT INTO user_id_mappings (
      canonical_id, posthog_person_id, jovida_uid, sls_user_id, email, device_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(canonical_id) DO UPDATE SET
      posthog_person_id = excluded.posthog_person_id,
      jovida_uid = excluded.jovida_uid,
      sls_user_id = excluded.sls_user_id,
      email = excluded.email,
      device_id = excluded.device_id,
      updated_at = datetime('now')
  `).run(
    mapping.canonical_id,
    mapping.posthog_person_id ?? null,
    mapping.jovida_uid ?? null,
    mapping.sls_user_id ?? null,
    mapping.email ?? null,
    mapping.device_id ?? null,
  );
}

export function getMappingByAnyIdentity(identity: string): UserIdMapping | null {
  const db = getDb();
  const row = db.prepare(`
    SELECT canonical_id, posthog_person_id, jovida_uid, sls_user_id, email, device_id, updated_at
    FROM user_id_mappings
    WHERE canonical_id = ? OR posthog_person_id = ? OR jovida_uid = ? OR sls_user_id = ? OR email = ? OR device_id = ?
    LIMIT 1
  `).get(identity, identity, identity, identity, identity, identity) as UserIdMapping | undefined;
  return row ?? null;
}

export function resolveIdentityForSystem(identity: string, target: 'posthog_person_id' | 'jovida_uid' | 'sls_user_id'): string | null {
  const mapping = getMappingByAnyIdentity(identity);
  if (!mapping) return null;
  const value = mapping[target];
  return typeof value === 'string' && value.trim() ? value : null;
}

export function listUserIdMappings(limit = 200): UserIdMapping[] {
  const db = getDb();
  const safeLimit = Math.min(Math.max(limit, 1), 1000);
  return db.prepare(`
    SELECT canonical_id, posthog_person_id, jovida_uid, sls_user_id, email, device_id, updated_at
    FROM user_id_mappings
    ORDER BY updated_at DESC
    LIMIT ?
  `).all(safeLimit) as UserIdMapping[];
}

