// apps/jowork/src/cluster.ts — Node.js multi-process entry point
//
// Architecture:
//   Primary process: runs the Scheduler (lightweight, no HTTP)
//   Worker processes: run the Express Gateway (1 per CPU core, max 4)
//
// Usage: node dist/cluster.js
// Single-core fallback: if only 1 CPU, runs everything in-process (same as index.js)

import cluster from 'node:cluster';
import { cpus } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  config, logger,
  openDb, initSchema,
  startScheduler,
} from '@jowork/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKER_MODULE = join(__dirname, 'index.js');

const MAX_WORKERS = Math.min(cpus().length, 4);
const numWorkers = Math.max(1, MAX_WORKERS);

if (cluster.isPrimary) {
  logger.info('Jowork cluster primary starting', { workers: numWorkers });

  // Primary runs the Scheduler (needs DB access)
  const db = openDb(config.dataDir);
  initSchema(db);

  // Simple scheduler runner: log for now (apps wire up real runners in index.ts)
  startScheduler(async (task) => {
    logger.debug('Scheduler tick', { task: task.name });
  });

  // Fork worker processes
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork({ JOWORK_WORKER: '1' });
  }

  // Restart crashed workers
  cluster.on('exit', (worker, code, signal) => {
    logger.warn('Worker died, restarting', { pid: worker.process.pid, code, signal });
    cluster.fork({ JOWORK_WORKER: '1' });
  });

  process.on('SIGTERM', () => {
    logger.info('Primary shutting down');
    for (const worker of Object.values(cluster.workers ?? {})) {
      worker?.send('shutdown');
    }
    process.exit(0);
  });
} else {
  // Worker: import and run the normal gateway entry point
  import(WORKER_MODULE).catch(err => {
    logger.error('Worker failed to start', { err: String(err) });
    process.exit(1);
  });
}
