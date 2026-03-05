// @jowork/core/models/store — persistent model provider storage (SQLite)
//
// Custom model providers are persisted in the model_providers table.
// On startup, loadCustomProviders() reads them into the in-memory registry.

import { getDb } from '../datamap/db.js';
import { generateId, nowISO, logger } from '../utils/index.js';
import {
  type ModelProvider,
  type ModelInfo,
  type ApiFormat,
  registerModelProvider,
  getModelProvider,
} from './provider.js';

// ─── DB row shape ────────────────────────────────────────────────────────────

interface ProviderRow {
  id: string;
  name: string;
  api_format: string;
  endpoint: string;
  models: string;       // JSON array of ModelInfo
  api_key_env: string | null;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function rowToProvider(row: ProviderRow): ModelProvider {
  let models: ModelInfo[] = [];
  try { models = JSON.parse(row.models) as ModelInfo[]; } catch { /* keep empty */ }

  return {
    id: row.id,
    name: row.name,
    apiFormat: row.api_format as ApiFormat,
    endpoint: row.endpoint,
    models,
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export interface CreateProviderInput {
  id: string;
  name: string;
  apiFormat: ApiFormat;
  endpoint: string;
  models?: ModelInfo[];
  apiKeyEnv?: string;
}

export function createCustomProvider(input: CreateProviderInput): ModelProvider {
  const db = getDb();
  const now = nowISO();
  const id = input.id || generateId();

  // Prevent overwriting built-in providers
  const existing = db.prepare(`SELECT id, is_builtin FROM model_providers WHERE id = ?`).get(id) as { is_builtin: number } | undefined;
  if (existing?.is_builtin) {
    throw new Error(`Cannot overwrite built-in provider: ${id}`);
  }

  const modelsJson = JSON.stringify(input.models ?? []);

  db.prepare(`
    INSERT OR REPLACE INTO model_providers (id, name, api_format, endpoint, models, api_key_env, is_builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, input.name, input.apiFormat, input.endpoint, modelsJson, input.apiKeyEnv ?? null, now, now);

  const provider: ModelProvider = {
    id,
    name: input.name,
    apiFormat: input.apiFormat,
    endpoint: input.endpoint,
    models: input.models ?? [],
  };
  registerModelProvider(provider);

  logger.info('Custom model provider created', { id, name: input.name });
  return provider;
}

export interface UpdateProviderInput {
  name?: string;
  apiFormat?: ApiFormat;
  endpoint?: string;
  models?: ModelInfo[];
  apiKeyEnv?: string | null;
}

export function updateCustomProvider(id: string, input: UpdateProviderInput): ModelProvider | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM model_providers WHERE id = ?`).get(id) as ProviderRow | undefined;
  if (!row) return null;
  if (row.is_builtin) throw new Error(`Cannot modify built-in provider: ${id}`);

  const name = input.name ?? row.name;
  const apiFormat = input.apiFormat ?? row.api_format;
  const endpoint = input.endpoint ?? row.endpoint;
  const models = input.models ? JSON.stringify(input.models) : row.models;
  const apiKeyEnv = input.apiKeyEnv !== undefined ? input.apiKeyEnv : row.api_key_env;

  db.prepare(`
    UPDATE model_providers SET name = ?, api_format = ?, endpoint = ?, models = ?, api_key_env = ?, updated_at = ?
    WHERE id = ?
  `).run(name, apiFormat, endpoint, models, apiKeyEnv, nowISO(), id);

  const provider: ModelProvider = {
    id,
    name,
    apiFormat: apiFormat as ApiFormat,
    endpoint,
    models: input.models ?? (JSON.parse(row.models) as ModelInfo[]),
  };
  registerModelProvider(provider);

  return provider;
}

export function deleteCustomProvider(id: string): boolean {
  const db = getDb();
  const row = db.prepare(`SELECT is_builtin FROM model_providers WHERE id = ?`).get(id) as { is_builtin: number } | undefined;
  if (!row) return false;
  if (row.is_builtin) throw new Error(`Cannot delete built-in provider: ${id}`);

  db.prepare(`DELETE FROM model_providers WHERE id = ?`).run(id);
  // Note: we don't remove from in-memory registry to avoid breaking active sessions.
  // On next restart, it won't be loaded.
  return true;
}

export function listCustomProviders(): ModelProvider[] {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM model_providers WHERE is_builtin = 0 ORDER BY name`).all() as ProviderRow[];
  return rows.map(rowToProvider);
}

export function getCustomProvider(id: string): ModelProvider | null {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM model_providers WHERE id = ?`).get(id) as ProviderRow | undefined;
  if (!row) return null;
  return rowToProvider(row);
}

// ─── Startup loader ──────────────────────────────────────────────────────────

/**
 * Load all custom providers from DB into the in-memory provider registry.
 * Called once at application startup, after DB init + migrations.
 */
export function loadCustomProviders(): number {
  const providers = listCustomProviders();
  for (const p of providers) {
    // Only register if not already present (built-in takes precedence)
    if (!getModelProvider(p.id)) {
      registerModelProvider(p);
    }
  }
  if (providers.length > 0) {
    logger.info('Custom model providers loaded', { count: providers.length });
  }
  return providers.length;
}
