import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { configPath, joworkDir } from './paths.js';

export interface JoWorkConfig {
  version: string;
  initialized: boolean;
  connectors: Record<string, { type: string; status: string }>;
  /** Max DB size in MB before warning (default 1024 = 1GB) */
  maxDbSizeMB?: number;
  /** Days to keep raw object bodies (0 = forever, default 0) */
  retentionDays?: number;
  /** Default sync interval in minutes (for daemon mode) */
  syncIntervalMinutes?: number;
  /** Per-source sync intervals in minutes (overrides default) */
  syncIntervals?: Record<string, number>;
}

const DEFAULT_CONFIG: JoWorkConfig = {
  version: '0.1.0',
  initialized: false,
  connectors: {},
  maxDbSizeMB: 1024,
  retentionDays: 0,
};

export function readConfig(): JoWorkConfig {
  const path = configPath();
  if (!existsSync(path)) return { ...DEFAULT_CONFIG };
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function writeConfig(config: JoWorkConfig): void {
  mkdirSync(joworkDir(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
}
