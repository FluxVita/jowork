import { getDb } from '../datamap/db.js';
import { getOrgSetting, setScopedValue } from '../auth/settings.js';

export const ALLOWED_TELEMETRY_EVENTS = new Set<string>([
  'telemetry_opt_in_changed',
  'system_setup_completed',
  'user_id_mapping_upserted',
]);

function telemetryRetentionDays(): number {
  const fromScoped = getOrgSetting('telemetry_retention_days');
  const raw = fromScoped ?? process.env['JOWORK_TELEMETRY_RETENTION_DAYS'] ?? '90';
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 90;
  return Math.min(Math.max(parsed, 1), 3650);
}

export function isTelemetryEnabled(): boolean {
  const scoped = getOrgSetting('telemetry_opt_in');
  if (scoped === 'true') return true;
  if (scoped === 'false') return false;
  return process.env['JOWORK_TELEMETRY_ENABLED'] === 'true';
}

export function setTelemetryEnabled(enabled: boolean): void {
  setScopedValue('org', 'default', 'telemetry_opt_in', enabled ? 'true' : 'false');
}

export function trackTelemetryEvent(eventName: string, userId?: string, payload?: Record<string, unknown>): void {
  if (!isTelemetryEnabled()) return;
  if (!ALLOWED_TELEMETRY_EVENTS.has(eventName)) return;
  const db = getDb();
  db.prepare(`
    INSERT INTO telemetry_events (event_name, user_id, payload_json)
    VALUES (?, ?, ?)
  `).run(eventName, userId ?? null, payload ? JSON.stringify(payload) : null);
}

export function listTelemetryEvents(limit = 100): Array<{
  timestamp: string;
  event_name: string;
  user_id: string | null;
  payload_json: string | null;
}> {
  const db = getDb();
  const safeLimit = Math.min(Math.max(limit, 1), 500);
  return db.prepare(`
    SELECT timestamp, event_name, user_id, payload_json
    FROM telemetry_events
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(safeLimit) as Array<{
    timestamp: string;
    event_name: string;
    user_id: string | null;
    payload_json: string | null;
  }>;
}

export function cleanupTelemetryEvents(): number {
  const db = getDb();
  const days = telemetryRetentionDays();
  const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
  const result = db.prepare(`DELETE FROM telemetry_events WHERE timestamp < ?`).run(cutoff);
  return result.changes;
}

export function getTelemetryPolicy(): { enabled: boolean; retention_days: number; allowed_events: string[] } {
  return {
    enabled: isTelemetryEnabled(),
    retention_days: telemetryRetentionDays(),
    allowed_events: Array.from(ALLOWED_TELEMETRY_EVENTS.values()),
  };
}
