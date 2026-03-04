// @jowork/core/network — Cloudflare Tunnel management
// Spawns `cloudflared` as a child process to create a quick-tunnel.
// The tunnel URL is parsed from cloudflared's stderr output.

import { spawn, ChildProcess } from 'node:child_process';
import { logger } from '../utils/index.js';

export type TunnelStatus = 'idle' | 'starting' | 'active' | 'error';

export interface TunnelState {
  status: TunnelStatus;
  url: string | null;
  error: string | null;
}

// Module-level singleton (one tunnel per process)
let proc: ChildProcess | null = null;
let tunnelState: TunnelState = { status: 'idle', url: null, error: null };

// ─── URL extraction pattern ────────────────────────────────────────────────────
// cloudflared prints the quick-tunnel URL to stderr in the form:
//   https://<slug>.trycloudflare.com
const TUNNEL_URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/;

// ─── Public API ───────────────────────────────────────────────────────────────

export function getTunnelState(): Readonly<TunnelState> {
  return { ...tunnelState };
}

/**
 * Start a Cloudflare quick-tunnel for the given local port.
 * Resolves with the public HTTPS URL when the tunnel is active.
 * Rejects if cloudflared is not installed, or times out in 30 s.
 */
export async function startTunnel(port: number): Promise<string> {
  if (proc !== null) {
    if (tunnelState.url) return tunnelState.url;
    throw new Error('Tunnel is already starting');
  }

  tunnelState = { status: 'starting', url: null, error: null };

  return new Promise<string>((resolve, reject) => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      stopTunnel();
      const err = 'Cloudflare Tunnel start timeout (30 s)';
      tunnelState = { status: 'error', url: null, error: err };
      reject(new Error(err));
    }, 30_000);

    try {
      proc = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
    } catch (e) {
      clearTimeout(timer);
      const err = `Failed to spawn cloudflared: ${String(e)}`;
      tunnelState = { status: 'error', url: null, error: err };
      proc = null;
      reject(new Error(err));
      return;
    }

    proc.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      const match = text.match(TUNNEL_URL_RE);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        tunnelState = { status: 'active', url: match[0], error: null };
        logger.info('Cloudflare Tunnel active', { url: match[0], port });
        resolve(match[0]);
      }
    });

    proc.on('error', (err: Error) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        const msg = `cloudflared error: ${err.message}`;
        tunnelState = { status: 'error', url: null, error: msg };
        proc = null;
        reject(new Error(msg));
      }
    });

    proc.on('exit', (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const msg = `cloudflared exited unexpectedly (code ${code})`;
        tunnelState = { status: 'error', url: null, error: msg };
        proc = null;
        reject(new Error(msg));
      } else {
        tunnelState = { status: 'idle', url: null, error: null };
        proc = null;
        logger.info('Cloudflare Tunnel closed');
      }
    });
  });
}

/** Stop the active tunnel (no-op if not running). */
export function stopTunnel(): void {
  if (!proc) return;
  try { proc.kill('SIGTERM'); } catch { /* ignore */ }
  proc = null;
  tunnelState = { status: 'idle', url: null, error: null };
  logger.info('Cloudflare Tunnel stopped');
}
