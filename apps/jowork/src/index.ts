// apps/jowork — open-source edition entry point
// Personal mode: no login required, data stored in OS standard paths

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

import {
  config, logger,
  openDb, initSchema, migrate,
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
} from '@jowork/core';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

async function main(): Promise<void> {
  // 1. Init DB — run schema + migrations (backs up if pending migrations exist)
  const db = openDb(config.dataDir);
  initSchema(db); // ensures tables exist for old installs before migrate()
  const { applied } = await migrate(db, { dataDir: config.dataDir });
  if (applied.length > 0) {
    logger.info('Migrations applied', { migrations: applied });
  }

  logger.info('Jowork starting', {
    mode: config.personalMode ? 'personal' : 'team',
    dataDir: config.dataDir,
    port: config.port,
  });

  // 2. Ensure default user + agent exist in personal mode
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
      expressApp.use(schedulerRouter());
      expressApp.use(networkRouter());
      expressApp.use(adminRouter());
      expressApp.use(channelsRouter());

      // Serve Vue 3 CDN SPA from public/
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
    logger.info('Jowork ready', {
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
