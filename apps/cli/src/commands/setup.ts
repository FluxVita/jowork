import { existsSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { readConfig, writeConfig } from '../utils/config.js';
import { dbPath } from '../utils/paths.js';
import { saveCredential, listCredentials } from '../connectors/credential-store.js';

export async function runSetupWizard(): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  console.log('');
  console.log('  Welcome to JoWork');
  console.log('  AI Agent Infrastructure — let agents truly understand your work');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('');

  // Step 1: Initialize
  const config = readConfig();
  if (!config.initialized || !existsSync(dbPath())) {
    console.log('  Step 1/4: Setting up local database...');
    const db = new DbManager(dbPath());
    db.ensureTables();
    db.close();
    writeConfig({ ...config, initialized: true });
    console.log('  ✓ Database created\n');
  } else {
    console.log('  Step 1/4: Database already exists ✓\n');
  }

  // Step 2: Register with an agent engine
  console.log('  Step 2/4: Connect to your AI agent');
  console.log('');
  const { engine } = await inquirer.prompt([{
    type: 'list',
    name: 'engine',
    message: 'Which AI agent do you use?',
    choices: [
      { name: 'Claude Code', value: 'claude-code' },
      { name: 'OpenAI Codex', value: 'codex' },
      { name: 'OpenClaw', value: 'openclaw' },
      { name: 'Skip for now', value: 'skip' },
    ],
  }]);

  if (engine !== 'skip') {
    await registerEngine(engine);
  } else {
    console.log('  Skipped. Run `jowork register <engine>` later.\n');
  }

  // Step 3: Connect data sources
  console.log('  Step 3/4: Connect a data source (optional)');
  console.log('');
  const { sources } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'sources',
    message: 'Which data sources do you want to connect?',
    choices: [
      { name: 'Feishu (飞书) — messages, meetings, docs', value: 'feishu' },
      { name: 'GitHub — repos, issues, PRs', value: 'github' },
      { name: 'GitLab — projects, issues, MRs', value: 'gitlab' },
      { name: 'Linear — issues', value: 'linear' },
      { name: 'PostHog — analytics, events', value: 'posthog' },
    ],
  }]);

  for (const source of sources as string[]) {
    await connectSource(source, inquirer);
  }

  // Step 4: First sync
  const connectedSources = listCredentials();
  if (connectedSources.length > 0) {
    console.log('\n  Step 4/4: Syncing your data...\n');

    const { runSync } = await import('./sync.js');
    try {
      await runSync(connectedSources);
    } catch {
      console.log('  ⚠ Some data sources failed to sync. Run `jowork sync` to retry.\n');
    }
  } else {
    console.log('\n  Step 4/4: No data sources connected. You can add them later.\n');
  }

  // Done
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('  ✓ JoWork is ready!\n');
  console.log('  What to do next:');
  console.log('    • Start a conversation with your AI agent — it now has');
  console.log('      access to your data via MCP tools');
  console.log('    • Run `jowork dashboard` to open the visual companion panel');
  console.log('    • Run `jowork status` to see your data overview');
  console.log('    • Run `jowork goal add "Your goal"` to set objectives');
  console.log('');
}

// ── Engine registration (reuses logic from register.ts) ──

async function registerEngine(engine: string): Promise<void> {
  const { readFileSync, writeFileSync, copyFileSync, existsSync: exists, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const HOME = process.env['HOME'] ?? '';

  switch (engine) {
    case 'claude-code': {
      const configPath = join(HOME, '.claude.json');
      if (exists(configPath)) {
        copyFileSync(configPath, configPath + '.bak');
      }
      let claudeConfig: Record<string, unknown> = {};
      if (exists(configPath)) {
        try { claudeConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { claudeConfig = {}; }
      }
      if (!claudeConfig.mcpServers) claudeConfig.mcpServers = {};
      (claudeConfig.mcpServers as Record<string, unknown>)['jowork'] = {
        command: 'jowork',
        args: ['serve'],
        env: { JOWORK_ENGINE: 'claude-code' },
      };
      writeFileSync(configPath, JSON.stringify(claudeConfig, null, 2));
      console.log('  ✓ Registered with Claude Code\n');
      break;
    }
    case 'codex': {
      const codexDir = join(HOME, '.codex');
      mkdirSync(codexDir, { recursive: true });
      const configPath = join(codexDir, 'config.toml');
      let content = exists(configPath) ? readFileSync(configPath, 'utf-8') : '';
      if (!content.includes('[mcp_servers.jowork]')) {
        content += '\n[mcp_servers.jowork]\ncommand = "jowork"\nargs = ["serve"]\n\n[mcp_servers.jowork.env]\nJOWORK_ENGINE = "codex"\n';
        writeFileSync(configPath, content);
      }
      console.log('  ✓ Registered with Codex\n');
      break;
    }
    case 'openclaw': {
      const openclawDir = join(HOME, '.openclaw');
      mkdirSync(openclawDir, { recursive: true });
      const configPath = join(openclawDir, 'config.json');
      let ocConfig: Record<string, unknown> = {};
      if (exists(configPath)) {
        try { ocConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { ocConfig = {}; }
      }
      if (!ocConfig.mcpServers) ocConfig.mcpServers = {};
      (ocConfig.mcpServers as Record<string, unknown>)['jowork'] = {
        command: 'jowork',
        args: ['serve'],
        env: { JOWORK_ENGINE: 'openclaw' },
      };
      writeFileSync(configPath, JSON.stringify(ocConfig, null, 2));
      console.log('  ✓ Registered with OpenClaw\n');
      break;
    }
  }
}

// ── Data source connection (streamlined for wizard context) ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connectSource(source: string, inquirer: any): Promise<void> {
  console.log(`\n  Connecting ${source}...`);

  switch (source) {
    case 'feishu': {
      console.log('');
      console.log('  To connect Feishu, you need an App ID and App Secret.');
      console.log('  Get them from: https://open.feishu.cn/app → Create App → Credentials');
      console.log('  (Or set FEISHU_APP_ID and FEISHU_APP_SECRET in your environment)');
      console.log('');

      let appId = process.env['FEISHU_APP_ID'];
      let appSecret = process.env['FEISHU_APP_SECRET'];

      if (!appId || !appSecret) {
        const answers = await inquirer.prompt([
          { type: 'input', name: 'appId', message: 'Feishu App ID:', when: !appId },
          { type: 'password', name: 'appSecret', message: 'Feishu App Secret:', when: !appSecret },
        ]);
        appId = appId ?? answers.appId;
        appSecret = appSecret ?? answers.appSecret;
      }

      if (appId && appSecret) {
        try {
          const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          });
          const data = await res.json() as { code: number };
          if (data.code === 0) {
            saveCredential('feishu', { type: 'feishu', data: { appId, appSecret }, createdAt: Date.now(), updatedAt: Date.now() });
            console.log('  ✓ Feishu connected');
          } else {
            console.log('  ✗ Feishu credentials invalid. Skipping.');
          }
        } catch {
          console.log('  ✗ Could not reach Feishu API. Skipping.');
        }
      }
      break;
    }
    case 'github': {
      console.log('');
      console.log('  To connect GitHub, you need a Personal Access Token.');
      console.log('  Create one at: https://github.com/settings/tokens → Generate new token (classic)');
      console.log('  Scopes needed: repo (read)');
      console.log('  (Or set GITHUB_PERSONAL_ACCESS_TOKEN in your environment)');
      console.log('');

      let token = process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];
      if (!token) {
        const answers = await inquirer.prompt([
          { type: 'password', name: 'token', message: 'GitHub Token:' },
        ]);
        token = answers.token;
      }

      if (token) {
        saveCredential('github', { type: 'github', data: { token }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log('  ✓ GitHub connected');
      }
      break;
    }
    case 'gitlab': {
      console.log('');
      console.log('  To connect GitLab, you need a Personal Access Token.');
      console.log('  Create one at: GitLab → Settings → Access Tokens');
      console.log('');

      const answers = await inquirer.prompt([
        { type: 'password', name: 'token', message: 'GitLab Token:' },
        { type: 'input', name: 'apiUrl', message: 'GitLab API URL (default: https://gitlab.com):', default: 'https://gitlab.com' },
      ]);

      if (answers.token) {
        saveCredential('gitlab', { type: 'gitlab', data: { token: answers.token, apiUrl: answers.apiUrl }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log('  ✓ GitLab connected');
      }
      break;
    }
    case 'linear': {
      console.log('');
      console.log('  To connect Linear, you need an API key.');
      console.log('  Get it from: Linear → Settings → API → Personal API keys');
      console.log('');

      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'Linear API Key:' },
      ]);

      if (answers.apiKey) {
        saveCredential('linear', { type: 'linear', data: { apiKey: answers.apiKey }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log('  ✓ Linear connected');
      }
      break;
    }
    case 'posthog': {
      console.log('');
      console.log('  To connect PostHog, you need a Personal API key.');
      console.log('  Get it from: PostHog → Settings → Personal API Keys');
      console.log('');

      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'PostHog API Key:' },
        { type: 'input', name: 'host', message: 'PostHog host (default: https://app.posthog.com):', default: 'https://app.posthog.com' },
      ]);

      if (answers.apiKey) {
        saveCredential('posthog', { type: 'posthog', data: { apiKey: answers.apiKey, host: answers.host, projectId: '1' }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log('  ✓ PostHog connected');
      }
      break;
    }
  }
}
