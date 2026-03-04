#!/usr/bin/env bun
// Jowork Gateway Sidecar — compiled to single binary via `bun build --compile`
// This is the entry point for the Tauri sidecar process.
// Uses bun:sqlite (built into Bun runtime, no native addon needed).
//
// Usage: jowork-gateway [--port 9800] [--data-dir /path/to/data]

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { Database as BunDatabase } from 'bun:sqlite';

// ── CLI argument parsing (minimal, no deps) ──

function parseArgs(argv: string[]): { port?: number; dataDir?: string } {
  const result: { port?: number; dataDir?: string } = {};
  for (let i = 2; i < argv.length; i++) {
    if ((argv[i] === '--port' || argv[i] === '-p') && argv[i + 1]) {
      result.port = parseInt(argv[++i]!, 10);
    } else if (argv[i] === '--data-dir' && argv[i + 1]) {
      result.dataDir = argv[++i]!;
    }
  }
  return result;
}

const args = parseArgs(process.argv);

// Override env vars from CLI args (before importing core, which reads config at import time)
if (args.port && !process.env['PORT']) {
  process.env['PORT'] = String(args.port);
}
if (args.dataDir && !process.env['JOWORK_DATA_DIR']) {
  process.env['JOWORK_DATA_DIR'] = args.dataDir;
}

// ── Import core AFTER env is set up ──

const {
  config, logger,
  setDb, initSchema, migrate,
  createApp,
  getEdition,
  getOnboardingState,
  advertiseMdns,
  networkRouter,
  adminRouter,
  channelsRouter,
  schedulerRouter,
  agentsRouter,
  onboardingRouter,
  usersRouter,
  sessionsRouter,
  chatRouter,
  connectorsRouter,
  memoryRouter,
  contextRouter,
  statsRouter,
  modelsRouter,
  searchRouter,
  terminalRouter,
  feedbackRouter,
} = await import('@jowork/core');

// ── Create bun:sqlite database with better-sqlite3-compatible .pragma() ──

function openBunDb(dataDir: string): InstanceType<typeof BunDatabase> & { pragma: (cmd: string, opts?: { simple?: boolean }) => unknown } {
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, 'jowork.db');
  const db = new BunDatabase(dbPath) as InstanceType<typeof BunDatabase> & { pragma: (cmd: string, opts?: { simple?: boolean }) => unknown };

  // Shim .pragma() which bun:sqlite lacks
  db.pragma = function pragma(cmd: string, opts?: { simple?: boolean }): unknown {
    const stmt = db.prepare(`PRAGMA ${cmd}`);
    if (opts?.simple) {
      const row = stmt.get() as Record<string, unknown> | undefined;
      return row ? Object.values(row)[0] : undefined;
    }
    return stmt.all();
  };

  return db;
}

// ── Resolve public dir ──

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

async function main(): Promise<void> {
  // 1. Init DB with bun:sqlite and inject into core
  const db = openBunDb(config.dataDir);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  // Inject into core's singleton so all routes/modules use this instance
  setDb(db as unknown as Parameters<typeof setDb>[0]);
  initSchema(db as unknown as Parameters<typeof initSchema>[0]);
  const { applied } = await migrate(db as unknown as Parameters<typeof migrate>[0], { dataDir: config.dataDir });
  if (applied.length > 0) {
    logger.info('Migrations applied', { migrations: applied });
  }

  logger.info('Jowork sidecar starting', {
    mode: config.personalMode ? 'personal' : 'team',
    dataDir: config.dataDir,
    port: config.port,
    runtime: 'bun',
  });

  // 2. Ensure default user + agent in personal mode
  if (config.personalMode) {
    const existing = db.prepare(`SELECT id FROM users WHERE id = 'personal'`).get();
    if (!existing) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES ('personal', 'You', 'you@local', 'owner', ?)`).run(now);
      db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES ('default', 'Jowork Agent', 'personal', 'You are Jowork, a helpful AI coworker that knows your business.', 'claude-3-5-sonnet-latest', ?)`).run(now);
    }
    const onboarding = getOnboardingState('personal');
    if (onboarding.currentStep !== 'complete') {
      logger.info('Onboarding step', { step: onboarding.currentStep });
    }
  }

  // 3. Create Express app with routes
  const app = createApp({
    port: config.port,
    setup(expressApp) {
      expressApp.use(usersRouter());
      expressApp.use(agentsRouter());
      expressApp.use(onboardingRouter());
      expressApp.use(sessionsRouter());
      expressApp.use(chatRouter());
      expressApp.use(memoryRouter());
      expressApp.use(connectorsRouter());
      expressApp.use(contextRouter());
      expressApp.use(statsRouter());
      expressApp.use(modelsRouter());
      expressApp.use(searchRouter());
      expressApp.use(terminalRouter());
      expressApp.use(schedulerRouter());
      expressApp.use(networkRouter());
      expressApp.use(adminRouter());
      expressApp.use(channelsRouter());
      expressApp.use(feedbackRouter());

      // Serve frontend from public/ (may not exist in sidecar mode)
      if (existsSync(join(PUBLIC_DIR, 'index.html'))) {
        expressApp.use((_req, res) => {
          res.sendFile(join(PUBLIC_DIR, 'index.html'));
        });
      }
    },
  });

  // 4. Start server + mDNS advertisement
  const server = createServer(app);
  const mdns = advertiseMdns(config.port);

  server.listen(config.port, () => {
    const edition = getEdition();
    // Signal to Tauri that gateway is ready (Tauri watches stdout for this)
    console.log(`Gateway ready on port ${config.port}`);
    logger.info('Jowork sidecar ready', {
      url: `http://localhost:${config.port}`,
      edition: edition.agentEngines.includes('claude-agent') ? 'premium' : 'free',
    });
  });

  process.on('SIGTERM', () => { mdns.stop(); server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { mdns.stop(); server.close(() => process.exit(0)); });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
