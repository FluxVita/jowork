// @jowork/core/platform — cross-platform utilities
//
// Centralises OS-specific logic so the rest of the codebase can stay
// platform-agnostic. All platform checks should go through this module.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';

export const platform = {
  isWindows: process.platform === 'win32',
  isMac:     process.platform === 'darwin',
  isLinux:   process.platform === 'linux',
  isDocker:  Boolean(process.env['JOWORK_IN_DOCKER']),
} as const;

/** OS-standard data directory for Jowork (respects JOWORK_DATA_DIR override) */
export function getDataDir(): string {
  if (process.env['JOWORK_DATA_DIR']) return process.env['JOWORK_DATA_DIR'];
  if (platform.isMac)     return join(homedir(), 'Library', 'Application Support', 'Jowork');
  if (platform.isWindows) return join(process.env['APPDATA'] ?? homedir(), 'Jowork');
  if (platform.isDocker)  return '/app/data';
  return join(homedir(), '.local', 'share', 'jowork');
}

/** OS-standard log directory */
export function getLogDir(): string {
  if (process.env['JOWORK_LOG_DIR']) return process.env['JOWORK_LOG_DIR'];
  if (platform.isMac)     return join(homedir(), 'Library', 'Logs', 'Jowork');
  if (platform.isWindows) return join(process.env['APPDATA'] ?? homedir(), 'Jowork', 'logs');
  if (platform.isDocker)  return '/app/logs';
  return join(homedir(), '.local', 'share', 'jowork', 'logs');
}

/** Ensure a directory exists, creating it recursively if needed */
export function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

/**
 * Normalize a shell command for the current platform.
 * On Windows, wraps command in cmd.exe /c.
 */
export function normalizeShellCommand(cmd: string): { cmd: string; args: string[] } {
  if (platform.isWindows) {
    return { cmd: 'cmd.exe', args: ['/c', cmd] };
  }
  return { cmd: '/bin/sh', args: ['-c', cmd] };
}

/** Check if the current process is running as a Tauri sidecar */
export function isTauriSidecar(): boolean {
  return Boolean(process.env['JOWORK_SIDECAR']);
}
