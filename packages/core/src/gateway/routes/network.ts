// @jowork/core/gateway/routes — network discovery + tunnel management API

import { Router } from 'express';
import { hostname } from 'node:os';
import { getLocalIps, getTunnelState, startTunnel, stopTunnel } from '../../network/index.js';
import { config } from '../../config.js';

/**
 * Network discovery and tunnel management routes.
 *
 * GET  /api/network/info          — server discovery info (LAN URLs, tunnel URL)
 * POST /api/admin/tunnel/start    — start Cloudflare quick-tunnel
 * POST /api/admin/tunnel/stop     — stop active tunnel
 * GET  /api/admin/tunnel/status   — current tunnel state
 */
export function networkRouter(): Router {
  const router = Router();
  const port = config.port;

  // ── Discovery endpoint ──────────────────────────────────────────────────────
  // Returns everything a client needs to connect to this gateway:
  // local URL, LAN URLs, and active tunnel URL (if any).
  // Also used to generate a QR code for mobile clients.
  router.get('/api/network/info', (_req, res) => {
    const ips = getLocalIps();
    const tunnel = getTunnelState();
    res.json({
      name: 'Jowork Gateway',
      version: '0.1.0',
      hostname: hostname(),
      ips,
      port,
      localUrl: `http://localhost:${port}`,
      lanUrls: ips.map(ip => `http://${ip}:${port}`),
      tunnelUrl: tunnel.url ?? null,
      tunnelStatus: tunnel.status,
    });
  });

  // ── Tunnel management ───────────────────────────────────────────────────────

  router.post('/api/admin/tunnel/start', (_req, res, next) => {
    startTunnel(port)
      .then(url => res.json({ ok: true, url }))
      .catch(next);
  });

  router.post('/api/admin/tunnel/stop', (_req, res) => {
    stopTunnel();
    res.json({ ok: true });
  });

  router.get('/api/admin/tunnel/status', (_req, res) => {
    res.json(getTunnelState());
  });

  return router;
}
