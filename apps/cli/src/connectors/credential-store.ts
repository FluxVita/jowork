import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  chmodSync,
  unlinkSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { credentialsDir } from '../utils/paths.js';

export interface Credential {
  type: string;
  data: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export function saveCredential(name: string, credential: Credential): void {
  const dir = credentialsDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${name}.json`);
  writeFileSync(filePath, JSON.stringify(credential, null, 2));
  try {
    chmodSync(filePath, 0o600);
  } catch {
    /* Windows fallback */
  }
}

export function loadCredential(name: string): Credential | null {
  const filePath = join(credentialsDir(), `${name}.json`);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

export function deleteCredential(name: string): void {
  const filePath = join(credentialsDir(), `${name}.json`);
  if (existsSync(filePath)) unlinkSync(filePath);
}

export function listCredentials(): string[] {
  const dir = credentialsDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}
