// @jowork/core — configuration management (no dotenv dependency, manual .env parse)

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// ─── Load .env file manually ─────────────────────────────────────────────────

function loadDotEnv(path: string): void {
  try {
    const raw = readFileSync(path, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
  } catch {
    // .env is optional
  }
}

loadDotEnv('.env');

// ─── Helpers ─────────────────────────────────────────────────────────────────

function env(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v !== undefined) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Required env var ${key} is not set`);
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const n = parseInt(v, 10);
  if (Number.isNaN(n)) throw new Error(`Env var ${key} must be an integer`);
  return n;
}

// ─── Config object ────────────────────────────────────────────────────────────

function resolveDataDir(): string {
  const explicit = process.env['JOWORK_DATA_DIR'];
  if (explicit) return explicit;
  // OS standard paths (Personal mode, no login required)
  const platform = process.platform;
  if (platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Jowork');
  if (platform === 'win32') return join(process.env['APPDATA'] ?? homedir(), 'Jowork');
  return join(homedir(), '.local', 'share', 'jowork');
}

export const config = {
  port: envInt('PORT', 18800),
  jwtSecret: env('JWT_SECRET', 'jowork-dev-secret-change-in-production'),
  dataDir: resolveDataDir(),
  nodeEnv: env('NODE_ENV', 'development'),
  logLevel: env('LOG_LEVEL', 'info'),
  personalMode: env('JOWORK_MODE', 'personal') === 'personal',
} as const;

export type Config = typeof config;
