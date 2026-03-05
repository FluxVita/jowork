// @jowork/core/connectors — connector registry and base interface
// Connectors: feishu, gitlab, linear, posthog, figma, email, oss
//             + JCP connectors: github, notion, slack, linear, gitlab, figma, jira, confluence (auto-registered below)

import type { ConnectorConfig, ConnectorId, ConnectorKind, SensitivityLevel } from '../types.js';
import { getDb } from '../datamap/db.js';
import { generateId, nowISO, logger } from '../utils/index.js';
import { withRetry } from '../utils/retry.js';
import { getEdition } from '../edition.js';
import { JoworkError } from '../types.js';
import { registerJCPConnector, getJCPConnector, listJCPConnectors } from './protocol.js';
import { githubConnector } from './github.js';
import { notionConnector } from './notion.js';
import { slackConnector } from './slack.js';
import { linearConnector } from './linear.js';
import { gitlabConnector } from './gitlab.js';
import { figmaConnector } from './figma.js';
import { jiraConnector } from './jira.js';
import { confluenceConnector } from './confluence.js';

// ─── Auto-register built-in JCP connectors ───────────────────────────────────
// These run at module load time so all imports of @jowork/core get them.

registerJCPConnector(githubConnector);
registerJCPConnector(notionConnector);
registerJCPConnector(slackConnector);
registerJCPConnector(linearConnector);
registerJCPConnector(gitlabConnector);
registerJCPConnector(figmaConnector);
registerJCPConnector(jiraConnector);
registerJCPConnector(confluenceConnector);

// Re-export cache module
export {
  syncConnectorItems,
  listConnectorItems,
  countConnectorItems,
  deleteConnectorItems,
} from './cache.js';
export type { ConnectorItem, SyncResult } from './cache.js';

// Re-export sync scheduler
export {
  startConnectorSyncScheduler,
  stopConnectorSyncScheduler,
} from './sync-scheduler.js';

// ─── Base interface ───────────────────────────────────────────────────────────

export interface ConnectorCapabilities {
  canDiscover: boolean;  // list available objects (repos, spaces, etc.)
  canFetch: boolean;     // fetch specific object by ID/URL
  canSearch: boolean;    // full-text search
  canWrite: boolean;     // create/update objects (Premium)
}

export interface DiscoverResult {
  id: string;
  name: string;
  kind: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface FetchResult {
  id: string;
  title: string;
  content: string;
  url?: string;
  updatedAt?: string;
  /** Suggested sensitivity for data retrieved from this connector. Defaults to 'internal'. */
  sensitivity?: SensitivityLevel;
}

export interface BaseConnector {
  kind: ConnectorKind;
  capabilities: ConnectorCapabilities;
  /** Default sensitivity for data fetched from this connector */
  defaultSensitivity: SensitivityLevel;
  discover(config: ConnectorConfig): Promise<DiscoverResult[]>;
  fetch(config: ConnectorConfig, id: string): Promise<FetchResult>;
  search?(config: ConnectorConfig, query: string): Promise<FetchResult[]>;
}

// ─── Connector health tracking ────────────────────────────────────────────────

export type ConnectorHealthStatus = 'healthy' | 'degraded' | 'unknown';

interface HealthEntry {
  status: ConnectorHealthStatus;
  failureCount: number;
  lastFailureAt?: string;
  lastSuccessAt?: string;
}

const healthMap = new Map<ConnectorKind, HealthEntry>();

function getHealth(kind: ConnectorKind): HealthEntry {
  return healthMap.get(kind) ?? { status: 'unknown', failureCount: 0 };
}

function recordSuccess(kind: ConnectorKind): void {
  const prev = getHealth(kind);
  if (prev.status !== 'healthy') {
    logger.info('Connector recovered', { kind });
  }
  healthMap.set(kind, { status: 'healthy', failureCount: 0, lastSuccessAt: nowISO() });
}

function recordFailure(kind: ConnectorKind, err: unknown): void {
  const prev = getHealth(kind);
  const failureCount = prev.failureCount + 1;
  const status: ConnectorHealthStatus = failureCount >= 3 ? 'degraded' : 'healthy';
  if (status === 'degraded' && prev.status !== 'degraded') {
    logger.warn('Connector degraded', { kind, failureCount, err: String(err) });
  }
  healthMap.set(kind, { status, failureCount, lastFailureAt: nowISO() });
}

export function getConnectorHealth(kind: ConnectorKind): HealthEntry {
  return getHealth(kind);
}

export function getAllConnectorHealth(): Record<string, HealthEntry> {
  return Object.fromEntries(healthMap.entries());
}

// ─── Registry ─────────────────────────────────────────────────────────────────

const registry = new Map<ConnectorKind, BaseConnector>();

export function registerConnector(connector: BaseConnector): void {
  registry.set(connector.kind, connector);
}

export function getConnector(kind: ConnectorKind): BaseConnector {
  const c = registry.get(kind);
  if (!c) throw new JoworkError('CONNECTOR_NOT_FOUND', `Connector '${kind}' is not registered`, 404);
  return c;
}

export function listRegisteredConnectors(): ConnectorKind[] {
  return Array.from(registry.keys());
}

// ─── JCP bridge helpers ───────────────────────────────────────────────────────

export interface ConnectorTypeInfo {
  id: string;
  name: string;
  system: 'legacy' | 'jcp';
  authType?: string;
  description?: string;
  /** JSON Schema object — configSchema.properties entries for the connector settings */
  configSchema?: Record<string, unknown>;
}

/** List all available connector types with manifest details for JCP connectors */
export function listAllConnectorTypes(): ConnectorTypeInfo[] {
  const legacy = Array.from(registry.keys()).map(k => ({ id: k as string, name: k as string, system: 'legacy' as const }));
  const jcp    = listJCPConnectors().map(m => ({
    id: m.id,
    name: m.name,
    system: 'jcp' as const,
    authType: m.authType,
    description: m.description,
    ...(m.configSchema !== undefined ? { configSchema: m.configSchema } : {}),
  }));
  return [...legacy, ...jcp];
}

/** Get the full manifest for a JCP connector type by ID */
export function getConnectorTypeManifest(id: string): import('./protocol.js').ConnectorManifest | undefined {
  return listJCPConnectors().find(m => m.id === id);
}

/**
 * Try to get a JCP connector by kind ID.
 * Returns undefined if not a JCP connector.
 */
export { getJCPConnector };

/**
 * Run a live health check against a JCP connector using its stored config.
 * Initializes the connector with cfg.settings and calls health().
 * Returns { ok, latencyMs, error? } — never throws.
 */
export async function checkConnectorHealth(
  cfg: ConnectorConfig,
): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const jcp = getJCPConnector(cfg.kind);
  if (!jcp) {
    return { ok: false, latencyMs: 0, error: 'NOT_A_JCP_CONNECTOR' };
  }
  try {
    const apiKey = cfg.settings['apiKey'] as string | undefined;
    await jcp.initialize(cfg.settings, apiKey ? { apiKey } : {});
    return await jcp.health();
  } catch (err) {
    return { ok: false, latencyMs: 0, error: String(err) };
  }
}

/**
 * Discover objects using either legacy or JCP connector.
 * JCP connectors are identified by their manifest ID matching the config kind.
 */
export async function discoverViaConnector(
  cfg: ConnectorConfig,
  cursor?: string,
): Promise<{ objects: { id: string; name: string; kind: string; url?: string; metadata?: Record<string, unknown> }[]; nextCursor?: string }> {
  const jcp = getJCPConnector(cfg.kind);
  if (jcp) {
    const apiKey = cfg.settings['apiKey'] as string | undefined;
    await jcp.initialize(cfg.settings, apiKey ? { apiKey } : {});
    const page = await jcp.discover(cursor);
    return {
      objects: page.objects.map(o => {
        const obj: { id: string; name: string; kind: string; url?: string; metadata?: Record<string, unknown> } = {
          id:   o.uri,
          name: o.name,
          kind: o.kind,
        };
        if (o.url      !== undefined) obj.url      = o.url;
        if (o.metadata !== undefined) obj.metadata = o.metadata;
        return obj;
      }),
      ...(page.nextCursor !== undefined ? { nextCursor: page.nextCursor } : {}),
    };
  }

  // Fall back to legacy system
  const connector = getConnector(cfg.kind);
  const results = await connector.discover(cfg);
  return {
    objects: results.map(r => {
      const obj: { id: string; name: string; kind: string; url?: string; metadata?: Record<string, unknown> } = {
        id:   r.id,
        name: r.name,
        kind: r.kind,
      };
      if (r.url      !== undefined) obj.url      = r.url;
      if (r.metadata !== undefined) obj.metadata = r.metadata;
      return obj;
    }),
  };
}

// ─── Self-healing wrapper ─────────────────────────────────────────────────────
// All connector calls go through withRetry + health tracking.

const RETRY_OPTS = { maxAttempts: 3, baseDelayMs: 500, maxDelayMs: 10_000, jitterMs: 200 };

export async function connectorDiscover(
  kind: ConnectorKind,
  config: ConnectorConfig,
): Promise<DiscoverResult[]> {
  const c = getConnector(kind);
  return withRetry(async () => {
    try {
      const result = await c.discover(config);
      recordSuccess(kind);
      return result;
    } catch (err) {
      recordFailure(kind, err);
      throw err;
    }
  }, RETRY_OPTS);
}

export async function connectorFetch(
  kind: ConnectorKind,
  config: ConnectorConfig,
  id: string,
): Promise<FetchResult> {
  const c = getConnector(kind);
  return withRetry(async () => {
    try {
      const result = await c.fetch(config, id);
      recordSuccess(kind);
      return result;
    } catch (err) {
      recordFailure(kind, err);
      throw err;
    }
  }, RETRY_OPTS);
}

export async function connectorSearch(
  kind: ConnectorKind,
  config: ConnectorConfig,
  query: string,
): Promise<FetchResult[]> {
  const c = getConnector(kind);
  if (!c.capabilities.canSearch || !c.search) {
    throw new JoworkError('NOT_SUPPORTED', `Connector '${kind}' does not support search`, 400);
  }
  return withRetry(async () => {
    try {
      const results = await c.search!(config, query);
      recordSuccess(kind);
      return results;
    } catch (err) {
      recordFailure(kind, err);
      throw err;
    }
  }, RETRY_OPTS);
}

// ─── CRUD (persisted configs) ─────────────────────────────────────────────────

export function createConnectorConfig(
  data: Omit<ConnectorConfig, 'id' | 'createdAt'>,
): ConnectorConfig {
  const edition = getEdition();
  const db = getDb();
  const count = (db.prepare(`SELECT COUNT(*) as n FROM connectors WHERE owner_id = ?`).get(data.ownerId) as { n: number }).n;
  if (count >= edition.maxDataSources) {
    throw new JoworkError('LIMIT_REACHED', `Max ${edition.maxDataSources} connectors allowed on this edition`, 403);
  }

  const cfg: ConnectorConfig = {
    ...data,
    id: generateId(),
    createdAt: nowISO(),
  };
  db.prepare(`
    INSERT INTO connectors (id, kind, name, settings, owner_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(cfg.id, cfg.kind, cfg.name, JSON.stringify(cfg.settings), cfg.ownerId, cfg.createdAt);
  return cfg;
}

export function listConnectorConfigs(ownerId: string): ConnectorConfig[] {
  const db = getDb();
  return (db.prepare(`SELECT * FROM connectors WHERE owner_id = ? ORDER BY created_at`).all(ownerId) as RawRow[]).map(fromRow);
}

export function getConnectorConfig(id: ConnectorId): ConnectorConfig {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM connectors WHERE id = ?`).get(id) as RawRow | undefined;
  if (!row) throw new JoworkError('NOT_FOUND', `Connector ${id} not found`, 404);
  return fromRow(row);
}

export function deleteConnectorConfig(id: ConnectorId): void {
  getDb().prepare(`DELETE FROM connectors WHERE id = ?`).run(id);
}

// ─── Internal ─────────────────────────────────────────────────────────────────

interface RawRow {
  id: string;
  kind: string;
  name: string;
  settings: string;
  owner_id: string;
  sync_schedule: string | null;
  last_sync_at: string | null;
  created_at: string;
}

function fromRow(row: RawRow): ConnectorConfig {
  const cfg: ConnectorConfig = {
    id: row.id,
    kind: row.kind as ConnectorKind,
    name: row.name,
    settings: JSON.parse(row.settings) as Record<string, unknown>,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
  if (row.sync_schedule !== null) cfg.syncSchedule = row.sync_schedule;
  if (row.last_sync_at !== null) cfg.lastSyncAt = row.last_sync_at;
  return cfg;
}

/**
 * Update the sync schedule for a connector.
 * Pass null/undefined to disable auto-sync.
 */
export function updateSyncSchedule(connectorId: ConnectorId, schedule: string | null): void {
  getDb().prepare(`UPDATE connectors SET sync_schedule = ? WHERE id = ?`).run(schedule, connectorId);
}

/**
 * Update a connector's mutable fields (name, settings, syncSchedule).
 * Returns the updated ConnectorConfig.
 */
export function updateConnectorConfig(
  connectorId: ConnectorId,
  updates: { name?: string; settings?: Record<string, unknown>; syncSchedule?: string | null },
): ConnectorConfig {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM connectors WHERE id = ?`).get(connectorId) as RawRow | undefined;
  if (!row) throw new JoworkError('NOT_FOUND', `Connector ${connectorId} not found`, 404);

  const sets: string[] = [];
  const vals: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push('name = ?');
    vals.push(updates.name);
  }
  if (updates.settings !== undefined) {
    sets.push('settings = ?');
    vals.push(JSON.stringify(updates.settings));
  }
  if (updates.syncSchedule !== undefined) {
    sets.push('sync_schedule = ?');
    vals.push(updates.syncSchedule);
  }

  if (sets.length === 0) return fromRow(row);

  vals.push(connectorId);
  db.prepare(`UPDATE connectors SET ${sets.join(', ')} WHERE id = ?`).run(...vals);

  const updated = db.prepare(`SELECT * FROM connectors WHERE id = ?`).get(connectorId) as RawRow;
  return fromRow(updated);
}

/**
 * Update last_sync_at timestamp for a connector (called by sync scheduler).
 */
export function updateLastSyncAt(connectorId: ConnectorId, ts: string): void {
  getDb().prepare(`UPDATE connectors SET last_sync_at = ? WHERE id = ?`).run(ts, connectorId);
}
