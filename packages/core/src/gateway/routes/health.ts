// @jowork/core/gateway/routes — enhanced health check
// Returns full-chain status: DB integrity, disk space, memory, uptime.

import { Router } from 'express';
import { statfsSync } from 'node:fs';
import { getDb } from '../../datamap/db.js';
import { config } from '../../config.js';
import { getAllConnectorHealth } from '../../connectors/index.js';
import { getTunnelState } from '../../network/tunnel.js';

const VERSION = '0.1.0';

function getDiskFreeGb(path: string): number | null {
  try {
    const stats = statfsSync(path);
    return (stats.bfree * stats.bsize) / (1024 ** 3);
  } catch {
    return null;
  }
}

export function healthRouter(): Router {
  const router = Router();

  // GET /health — basic liveness probe (always fast, no DB access)
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', version: VERSION, ts: new Date().toISOString() });
  });

  // GET /health/full — full-chain readiness probe
  router.get('/health/full', (_req, res) => {
    const issues: string[] = [];
    let dbStatus = 'ok';
    let dbIntegrity = 'ok';

    try {
      const db = getDb();
      const rows = db.pragma('integrity_check') as Array<{ integrity_check: string }>;
      dbIntegrity = rows[0]?.integrity_check ?? 'unknown';
      if (dbIntegrity !== 'ok') {
        dbStatus = 'degraded';
        issues.push('DB integrity: ' + dbIntegrity);
      }
    } catch (err) {
      dbStatus = 'error';
      dbIntegrity = String(err);
      issues.push('DB unavailable');
    }

    const diskFreeGb = getDiskFreeGb(config.dataDir);
    if (diskFreeGb !== null && diskFreeGb < 0.5) {
      issues.push('Low disk space: ' + diskFreeGb.toFixed(2) + ' GB free');
    }

    const mem = process.memoryUsage();
    const heapUsedMb = Math.round(mem.heapUsed / (1024 * 1024));
    const rssMb = Math.round(mem.rss / (1024 * 1024));

    const connectorHealth = getAllConnectorHealth();
    const degradedConnectors = Object.entries(connectorHealth)
      .filter(([, h]) => h.status === 'degraded')
      .map(([k]) => k);
    if (degradedConnectors.length > 0) {
      issues.push('Degraded connectors: ' + degradedConnectors.join(', '));
    }

    const tunnel = getTunnelState();
    const overallStatus = issues.length === 0 ? 'ok' : 'degraded';

    res.status(issues.length === 0 ? 200 : 207).json({
      status: overallStatus,
      version: VERSION,
      uptime: Math.round(process.uptime()),
      db: { status: dbStatus, integrity: dbIntegrity },
      disk: {
        dataDir: config.dataDir,
        freeGb: diskFreeGb !== null ? Math.round(diskFreeGb * 100) / 100 : null,
        warning: diskFreeGb !== null && diskFreeGb < 0.5,
      },
      memory: { heapUsedMb, rssMb },
      connectors: { health: connectorHealth, degraded: degradedConnectors },
      tunnel: { status: tunnel.status, url: tunnel.url },
      issues,
      ts: new Date().toISOString(),
    });
  });

  return router;
}
