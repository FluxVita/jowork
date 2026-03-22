import { existsSync } from 'node:fs';
import { DbManager } from '../db/manager.js';
import { readConfig, writeConfig } from '../utils/config.js';
import { dbPath } from '../utils/paths.js';
import { saveCredential, listCredentials } from '../connectors/credential-store.js';

// ── i18n: auto-detect system language ──

function isZh(): boolean {
  const lang = process.env['LANG'] ?? process.env['LC_ALL'] ?? process.env['LANGUAGE'] ?? '';
  return lang.toLowerCase().startsWith('zh');
}

const t = isZh() ? {
  welcome: '欢迎使用 JoWork',
  subtitle: 'AI Agent 基础设施 — 让 Agent 真正理解你的工作',
  step1: '第 1/4 步：初始化本地数据库...',
  step1Done: '✓ 数据库已创建',
  step1Exists: '第 1/4 步：数据库已存在 ✓',
  step2: '第 2/4 步：连接你的 AI 助手',
  step2Q: '你想安装到哪些 AI 助手？（空格选择，回车确认）',
  step2Skip: '已跳过。稍后运行 `jowork register <engine>` 添加。',
  step3: '第 3/4 步：连接数据源（可选）',
  step3Q: '你想连接哪些数据源？（空格选择，回车确认）',
  step4Syncing: '第 4/4 步：正在同步你的数据...',
  step4NoSource: '第 4/4 步：暂未连接数据源，稍后可添加。',
  syncFail: '⚠ 部分数据源同步失败。运行 `jowork sync` 重试。',
  ready: '✓ JoWork 已就绪！',
  nextTitle: '接下来可以：',
  next1: '• 跟你的 AI 助手对话 — 它现在能通过 MCP 访问你的数据了',
  next2: '• 运行 `jowork dashboard` 打开可视化面板',
  next3: '• 运行 `jowork status` 查看数据概览',
  next4: '• 运行 `jowork goal add "你的目标"` 设置工作目标',
  registered: (name: string) => `  ✓ 已注册到 ${name}`,
  connecting: (name: string) => `\n  正在连接 ${name}...`,
  connected: (name: string) => `  ✓ ${name} 已连接`,
  connFailed: (name: string) => `  ✗ ${name} 凭证无效，已跳过。`,
  connNetErr: (name: string) => `  ✗ 无法连接 ${name} API，已跳过。`,
  feishuHelp: '  需要飞书 App ID 和 App Secret。\n  获取方式：https://open.feishu.cn/app → 创建应用 → 凭证与基础信息\n  （也可设置环境变量 FEISHU_APP_ID 和 FEISHU_APP_SECRET）',
  githubHelp: '  需要 GitHub Personal Access Token。\n  创建方式：https://github.com/settings/tokens → Generate new token\n  所需权限：repo (read)\n  （也可设置环境变量 GITHUB_PERSONAL_ACCESS_TOKEN）',
  gitlabHelp: '  需要 GitLab Personal Access Token。\n  创建方式：GitLab → Settings → Access Tokens',
  linearHelp: '  需要 Linear API Key。\n  获取方式：Linear → Settings → API → Personal API keys',
  posthogHelp: '  需要 PostHog Personal API Key。\n  获取方式：PostHog → Settings → Personal API Keys',
} : {
  welcome: 'Welcome to JoWork',
  subtitle: 'AI Agent Infrastructure — let agents truly understand your work',
  step1: 'Step 1/4: Setting up local database...',
  step1Done: '✓ Database created',
  step1Exists: 'Step 1/4: Database already exists ✓',
  step2: 'Step 2/4: Connect to your AI agents',
  step2Q: 'Which agents do you want to install to? (space to select, enter to confirm)',
  step2Skip: 'Skipped. Run `jowork register <engine>` later.',
  step3: 'Step 3/4: Connect a data source (optional)',
  step3Q: 'Which data sources do you want to connect? (space to select, enter to confirm)',
  step4Syncing: 'Step 4/4: Syncing your data...',
  step4NoSource: 'Step 4/4: No data sources connected. You can add them later.',
  syncFail: '⚠ Some data sources failed to sync. Run `jowork sync` to retry.',
  ready: '✓ JoWork is ready!',
  nextTitle: 'What to do next:',
  next1: '• Start a conversation with your AI agent — it now has access to your data via MCP tools',
  next2: '• Run `jowork dashboard` to open the visual companion panel',
  next3: '• Run `jowork status` to see your data overview',
  next4: '• Run `jowork goal add "Your goal"` to set objectives',
  registered: (name: string) => `  ✓ Registered with ${name}`,
  connecting: (name: string) => `\n  Connecting ${name}...`,
  connected: (name: string) => `  ✓ ${name} connected`,
  connFailed: (name: string) => `  ✗ ${name} credentials invalid. Skipping.`,
  connNetErr: (name: string) => `  ✗ Could not reach ${name} API. Skipping.`,
  feishuHelp: '  To connect Feishu, you need an App ID and App Secret.\n  Get them from: https://open.feishu.cn/app → Create App → Credentials\n  (Or set FEISHU_APP_ID and FEISHU_APP_SECRET in your environment)',
  githubHelp: '  To connect GitHub, you need a Personal Access Token.\n  Create one at: https://github.com/settings/tokens → Generate new token (classic)\n  Scopes needed: repo (read)\n  (Or set GITHUB_PERSONAL_ACCESS_TOKEN in your environment)',
  gitlabHelp: '  To connect GitLab, you need a Personal Access Token.\n  Create one at: GitLab → Settings → Access Tokens',
  linearHelp: '  To connect Linear, you need an API key.\n  Get it from: Linear → Settings → API → Personal API keys',
  posthogHelp: '  To connect PostHog, you need a Personal API key.\n  Get it from: PostHog → Settings → Personal API Keys',
};

// ── Setup Wizard ──

export async function runSetupWizard(): Promise<void> {
  const { default: inquirer } = await import('inquirer');

  console.log('');
  console.log(`  ${t.welcome}`);
  console.log(`  ${t.subtitle}`);
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('');

  // Step 1: Initialize
  const config = readConfig();
  if (!config.initialized || !existsSync(dbPath())) {
    console.log(`  ${t.step1}`);
    const db = new DbManager(dbPath());
    db.ensureTables();
    db.close();
    writeConfig({ ...config, initialized: true });
    console.log(`  ${t.step1Done}\n`);
  } else {
    console.log(`  ${t.step1Exists}\n`);
  }

  // Step 2: Register with agent engines (multi-select)
  console.log(`  ${t.step2}`);
  console.log('');
  const { engines } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'engines',
    message: t.step2Q,
    choices: [
      { name: 'Claude Code', value: 'claude-code', checked: true },
      { name: 'OpenAI Codex', value: 'codex' },
      { name: 'Cursor', value: 'cursor' },
      { name: 'OpenClaw', value: 'openclaw' },
    ],
  }]);

  if ((engines as string[]).length > 0) {
    for (const engine of engines as string[]) {
      await registerEngine(engine);
    }
  } else {
    console.log(`  ${t.step2Skip}\n`);
  }

  // Step 3: Connect data sources
  console.log(`  ${t.step3}`);
  console.log('');
  const { sources } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'sources',
    message: t.step3Q,
    choices: [
      { name: isZh() ? '飞书 — 消息、会议、文档' : 'Feishu (飞书) — messages, meetings, docs', value: 'feishu' },
      { name: 'GitHub — repos, issues, PRs', value: 'github' },
      { name: 'GitLab — projects, issues, MRs', value: 'gitlab' },
      { name: 'Linear — issues', value: 'linear' },
      { name: isZh() ? 'PostHog — 用户行为分析' : 'PostHog — analytics, events', value: 'posthog' },
    ],
  }]);

  for (const source of sources as string[]) {
    await connectSource(source, inquirer);
  }

  // Step 4: First sync
  const connectedSources = listCredentials();
  if (connectedSources.length > 0) {
    console.log(`\n  ${t.step4Syncing}\n`);

    const { runSync } = await import('./sync.js');
    try {
      await runSync(connectedSources);
    } catch {
      console.log(`  ${t.syncFail}\n`);
    }
  } else {
    console.log(`\n  ${t.step4NoSource}\n`);
  }

  // Done
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log(`  ${t.ready}\n`);
  console.log(`  ${t.nextTitle}`);
  console.log(`    ${t.next1}`);
  console.log(`    ${t.next2}`);
  console.log(`    ${t.next3}`);
  console.log(`    ${t.next4}`);
  console.log('');
}

// ── Engine registration ──

async function registerEngine(engine: string): Promise<void> {
  const { readFileSync, writeFileSync, copyFileSync, existsSync: exists, mkdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const HOME = process.env['HOME'] ?? '';

  const displayNames: Record<string, string> = {
    'claude-code': 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    openclaw: 'OpenClaw',
  };

  switch (engine) {
    case 'claude-code': {
      const configPath = join(HOME, '.claude.json');
      if (exists(configPath)) copyFileSync(configPath, configPath + '.bak');
      let claudeConfig: Record<string, unknown> = {};
      if (exists(configPath)) {
        try { claudeConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { claudeConfig = {}; }
      }
      if (!claudeConfig.mcpServers) claudeConfig.mcpServers = {};
      (claudeConfig.mcpServers as Record<string, unknown>)['jowork'] = {
        command: 'jowork', args: ['serve'], env: { JOWORK_ENGINE: 'claude-code' },
      };
      writeFileSync(configPath, JSON.stringify(claudeConfig, null, 2));
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
      break;
    }
    case 'cursor': {
      const cursorDir = join(HOME, '.cursor');
      mkdirSync(cursorDir, { recursive: true });
      const configPath = join(cursorDir, 'mcp.json');
      let cursorConfig: Record<string, unknown> = {};
      if (exists(configPath)) {
        try { cursorConfig = JSON.parse(readFileSync(configPath, 'utf-8')); } catch { cursorConfig = {}; }
      }
      if (!cursorConfig.mcpServers) cursorConfig.mcpServers = {};
      (cursorConfig.mcpServers as Record<string, unknown>)['jowork'] = {
        command: 'jowork', args: ['serve'], env: { JOWORK_ENGINE: 'cursor' },
      };
      writeFileSync(configPath, JSON.stringify(cursorConfig, null, 2));
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
        command: 'jowork', args: ['serve'], env: { JOWORK_ENGINE: 'openclaw' },
      };
      writeFileSync(configPath, JSON.stringify(ocConfig, null, 2));
      break;
    }
  }
  console.log(t.registered(displayNames[engine] ?? engine));
}

// ── Data source connection ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connectSource(source: string, inquirer: any): Promise<void> {
  console.log(t.connecting(source));

  switch (source) {
    case 'feishu': {
      console.log('');
      console.log(t.feishuHelp);
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
            console.log(t.connected('Feishu'));
          } else {
            console.log(t.connFailed('Feishu'));
          }
        } catch {
          console.log(t.connNetErr('Feishu'));
        }
      }
      break;
    }
    case 'github': {
      console.log('');
      console.log(t.githubHelp);
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
        console.log(t.connected('GitHub'));
      }
      break;
    }
    case 'gitlab': {
      console.log('');
      console.log(t.gitlabHelp);
      console.log('');

      const answers = await inquirer.prompt([
        { type: 'password', name: 'token', message: 'GitLab Token:' },
        { type: 'input', name: 'apiUrl', message: 'GitLab API URL (default: https://gitlab.com):', default: 'https://gitlab.com' },
      ]);

      if (answers.token) {
        saveCredential('gitlab', { type: 'gitlab', data: { token: answers.token, apiUrl: answers.apiUrl }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(t.connected('GitLab'));
      }
      break;
    }
    case 'linear': {
      console.log('');
      console.log(t.linearHelp);
      console.log('');

      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'Linear API Key:' },
      ]);

      if (answers.apiKey) {
        saveCredential('linear', { type: 'linear', data: { apiKey: answers.apiKey }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(t.connected('Linear'));
      }
      break;
    }
    case 'posthog': {
      console.log('');
      console.log(t.posthogHelp);
      console.log('');

      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'PostHog API Key:' },
        { type: 'input', name: 'host', message: 'PostHog host (default: https://app.posthog.com):', default: 'https://app.posthog.com' },
      ]);

      if (answers.apiKey) {
        saveCredential('posthog', { type: 'posthog', data: { apiKey: answers.apiKey, host: answers.host, projectId: '1' }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(t.connected('PostHog'));
      }
      break;
    }
  }
}
