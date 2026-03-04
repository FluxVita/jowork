// @jowork/premium/ai-services/klaude-manager — Klaude lifecycle management
// Klaude is the self-hosted Claude proxy, running on port 8899

import { logger } from '@jowork/core';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const KLAUDE_PORT = parseInt(process.env['KLAUDE_PORT'] ?? '8899', 10);
const KLAUDE_URL = `http://localhost:${KLAUDE_PORT}`;

export async function isKlaudeRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${KLAUDE_URL}/health`, { signal: AbortSignal.timeout(1000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function startKlaude(): Promise<void> {
  if (await isKlaudeRunning()) {
    logger.info('Klaude already running', { port: KLAUDE_PORT });
    return;
  }
  logger.info('Starting Klaude', { port: KLAUDE_PORT });
  // Start in background — user must have klaude installed globally
  execAsync(`klaude start --port ${KLAUDE_PORT}`).catch(err =>
    logger.error('Failed to start Klaude', { err: String(err) }),
  );
}

export async function stopKlaude(): Promise<void> {
  try {
    await fetch(`${KLAUDE_URL}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(3000) });
    logger.info('Klaude stopped');
  } catch {
    logger.warn('Could not gracefully stop Klaude');
    await execAsync(`pkill -f "klaude start"`).catch(() => null);
  }
}

/** Get the Klaude base URL for model routing */
export function getKlaudeBaseUrl(): string {
  return KLAUDE_URL;
}
