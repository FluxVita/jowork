// @jowork/core/connectors — connector registry and base interface
// Connectors: feishu, gitlab, linear, posthog, figma, email, oss

import type { ConnectorConfig, ConnectorId, ConnectorKind, SensitivityLevel } from '../types.js';
import { getDb } from '../datamap/db.js';
import { generateId, nowISO } from '../utils/index.js';
import { getEdition } from '../edition.js';
import { JoworkError } from '../types.js';

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
  created_at: string;
}

function fromRow(row: RawRow): ConnectorConfig {
  return {
    id: row.id,
    kind: row.kind as ConnectorKind,
    name: row.name,
    settings: JSON.parse(row.settings) as Record<string, unknown>,
    ownerId: row.owner_id,
    createdAt: row.created_at,
  };
}
