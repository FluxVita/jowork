// apps/fluxvita — FluxVita internal edition entry point
// Loads @jowork/core + @jowork/premium for full feature set

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

import {
  config, logger,
  openDb, initSchema,
  createApp,
  getEdition,
  getOnboardingState,
} from '@jowork/core';

import { activatePremium } from '@jowork/premium';

import { sessionsRouter } from './routes/sessions.js';
import { chatRouter } from './routes/chat.js';
import { memoryRouter } from './routes/memory.js';
import { connectorsRouter } from './routes/connectors.js';
import { contextRouter } from './routes/context.js';
import { premiumRouter } from './routes/premium.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');

// Activate premium at startup (license key from env, empty = dev mode)
const licenseKey = process.env['JOWORK_LICENSE_KEY'] ?? '';
activatePremium(licenseKey || undefined);

async function main(): Promise<void> {
  const db = openDb(config.dataDir);
  initSchema(db);

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
      expressApp.use(sessionsRouter());
      expressApp.use(chatRouter());
      expressApp.use(memoryRouter());
      expressApp.use(connectorsRouter());
      expressApp.use(contextRouter());
      expressApp.use(premiumRouter());

      // Serve FluxVita SPA from public/
      if (existsSync(join(PUBLIC_DIR, 'index.html'))) {
        expressApp.use((_req, res) => {
          res.sendFile(join(PUBLIC_DIR, 'index.html'));
        });
      }
    },
  });

  const server = createServer(app);
  server.listen(config.port, () => {
    logger.info('FluxVita ready', {
      url: `http://localhost:${config.port}`,
      edition: 'premium',
    });
  });

  process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
  process.on('SIGINT', () => { server.close(() => process.exit(0)); });
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
