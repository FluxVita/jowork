import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { configPath, joworkDir } from './paths.js';

export interface JoWorkConfig {
  version: string;
  initialized: boolean;
  connectors: Record<string, { type: string; status: string }>;
}

const DEFAULT_CONFIG: JoWorkConfig = {
  version: '0.1.0',
  initialized: false,
  connectors: {},
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
