// apps/fluxvita — FluxVita internal edition entry point
// Loads @jowork/core + @jowork/premium for full feature set

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
  modelsRouter,
  searchRouter,
  terminalRouter,
} from '@jowork/core';

import { activatePremium, dispatch } from '@jowork/premium';
import { premiumRouter } from './routes/premium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Activate premium at startup — subscription token from env, empty = dev mode
// activatePremium is async now; call inside main() after config.dataDir is available

async function main(): Promise<void> {
  // Activate premium before DB open so edition limits are set correctly
  await activatePremium({
    token: process.env['JOWORK_SUBSCRIPTION_TOKEN'] ?? '',
    dataDir: config.dataDir,
  });

  const db = openDb(config.dataDir);
  initSchema(db); // ensures tables exist for old installs before migrate()
  const { applied } = await migrate(db, { dataDir: config.dataDir });
  if (applied.length > 0) {
    logger.info('Migrations applied', { migrations: applied });
  }

  const edition = getEdition();
  logger.info('FluxVita starting', {
    mode: config.personalMode ? 'personal' : 'team',
    dataDir: config.dataDir,
    port: config.port,
    engines: edition.agentEngines,
    geekMode: edition.hasGeekMode,
  });

  // Ensure default user + agent exist in personal mode
  if (config.personalMode) {
    const existing = db.prepare(`SELECT id FROM users WHERE id = 'personal'`).get();
    if (!existing) {
      const now = new Date().toISOString();
      db.prepare(`INSERT INTO users (id, name, email, role, created_at) VALUES ('personal', 'You', 'you@local', 'owner', ?)`)
        .run(now);
      db.prepare(`INSERT OR IGNORE INTO agents (id, name, owner_id, system_prompt, model, created_at) VALUES ('default', 'FluxVita Agent', 'personal', 'You are FluxVita, a helpful AI coworker that knows your business.', 'claude-3-5-sonnet-latest', ?)`)
        .run(now);
    }
    const onboarding = getOnboardingState('personal');
    if (onboarding.currentStep !== 'complete') {
      logger.info('Onboarding step', { step: onboarding.currentStep });
    }
  }

  const app = createApp({
    port: config.port,
    setup(expressApp) {
      expressApp.use(usersRouter());
      expressApp.use(agentsRouter());
      expressApp.use(onboardingRouter());
      expressApp.use(sessionsRouter());
      expressApp.use(chatRouter(dispatch));
      expressApp.use(memoryRouter());
      expressApp.use(connectorsRouter());
      expressApp.use(contextRouter());
      expressApp.use(premiumRouter());
      expressApp.use(statsRouter());
      expressApp.use(modelsRouter());
      expressApp.use(searchRouter());
      expressApp.use(terminalRouter());
      expressApp.use(schedulerRouter());
      expressApp.use(networkRouter());
      expressApp.use(adminRouter());
      expressApp.use(channelsRouter());

      // Serve FluxVita SPA from public/
      if (existsSync(join(PUBLIC_DIR, 'index.html'))) {
        expressApp.use((_req, res) => {
          res.sendFile(join(PUBLIC_DIR, 'index.html'));
        });
      }
    },
  });

  const server = createServer(app);
  const mdns = advertiseMdns(config.port, 'fluxvita-gateway');

  server.listen(config.port, () => {
    logger.info('FluxVita ready', {
      url: `http://localhost:${config.port}`,
      edition: 'premium',
    });
  });

  process.on('SIGTERM', () => { mdns.stop(); server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { mdns.stop(); server.close(() => process.exit(0)); });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
