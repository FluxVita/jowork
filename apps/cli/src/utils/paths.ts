import { join } from 'node:path';
import { mkdirSync, chmodSync } from 'node:fs';

const HOME = process.env['HOME'] ?? '/tmp';

export function joworkDir(): string {
  return join(HOME, '.jowork');
}

export function dataDir(): string {
  const dir = join(joworkDir(), 'data');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(dataDir(), 'jowork.db');
}

export function credentialsDir(): string {
  const dir = join(joworkDir(), 'credentials');
  mkdirSync(dir, { recursive: true });
  try {
    chmodSync(dir, 0o700);
  } catch {
    /* Windows — non-critical */
  }
  return dir;
}

export function configPath(): string {
  return join(joworkDir(), 'config.json');
}

export function logsDir(): string {
  const dir = join(joworkDir(), 'logs');
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function fileRepoDir(): string {
  const dir = join(joworkDir(), 'data', 'repo');
  mkdirSync(dir, { recursive: true });
  return dir;
}
