// apps/fluxvita/src/cluster.ts — Node.js multi-process entry point (FluxVita edition)
//
// Architecture:
//   Primary process: runs the Scheduler
//   Worker processes: run the Express Gateway (1 per CPU core, max 4)

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
  logger.info('FluxVita cluster primary starting', { workers: numWorkers });

  const db = openDb(config.dataDir);
  initSchema(db);

  startScheduler(async (task) => {
    logger.debug('Scheduler tick', { task: task.name });
  });

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork({ JOWORK_WORKER: '1' });
  }

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
  import(WORKER_MODULE).catch(err => {
    logger.error('Worker failed to start', { err: String(err) });
    process.exit(1);
  });
}
