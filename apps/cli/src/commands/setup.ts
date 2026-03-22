import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { DbManager } from '../db/manager.js';
import { readConfig, writeConfig } from '../utils/config.js';
import { dbPath } from '../utils/paths.js';
import { saveCredential, listCredentials } from '../connectors/credential-store.js';

const HOME = process.env['HOME'] ?? '';

// ── Language detection ──

function isZh(): boolean {
  const lang = process.env['LANG'] ?? process.env['LC_ALL'] ?? process.env['LANGUAGE'] ?? '';
  if (lang.toLowerCase().startsWith('zh')) return true;
  if (process.platform === 'darwin') {
    try {
      const appleLangs = execSync('defaults read -g AppleLanguages 2>/dev/null', { encoding: 'utf-8' });
      const firstLang = appleLangs.match(/"([^"]+)"/)?.[1] ?? '';
      if (firstLang.startsWith('zh')) return true;
    } catch { /* ignore */ }
  }
  return false;
}

const zh = isZh();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _inquirer: any;

/** Yes/No prompt using arrow keys + enter (not y/n typing) */
async function askYesNo(message: string, defaultYes = true): Promise<boolean> {
  const yesLabel = zh ? '是' : 'Yes';
  const noLabel = zh ? '否' : 'No';
  const { answer } = await _inquirer.prompt([{
    type: 'list',
    name: 'answer',
    message,
    choices: [
      { name: yesLabel, value: true },
      { name: noLabel, value: false },
    ],
    default: defaultYes ? 0 : 1,
  }]);
  return answer;
}

// ── Setup Wizard ──

export async function runSetupWizard(): Promise<void> {
  const { default: inquirer } = await import('inquirer');
  _inquirer = inquirer;

  // ── Welcome ──
  console.log('');
  console.log(zh
    ? '  欢迎使用 JoWork'
    : '  Welcome to JoWork');
  console.log(zh
    ? '  让 AI Agent 真正理解你的工作'
    : '  Let AI agents truly understand your work');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log('');

  // ── Step 1: Auto-init (no interaction needed) ──
  const config = readConfig();
  if (!config.initialized || !existsSync(dbPath())) {
    const db = new DbManager(dbPath());
    db.ensureTables();
    db.close();
    writeConfig({ ...config, initialized: true });
    console.log(zh ? '  ✓ 本地数据库已创建' : '  ✓ Local database created');
  } else {
    console.log(zh ? '  ✓ 本地数据库已就绪' : '  ✓ Local database ready');
  }

  // ── Step 2: Auto-detect & register agents ──
  const detected = detectInstalledAgents();
  if (detected.length > 0) {
    console.log('');
    console.log(zh
      ? `  检测到 ${detected.length} 个 AI 助手：${detected.map(a => a.name).join('、')}`
      : `  Detected ${detected.length} agent${detected.length > 1 ? 's' : ''}: ${detected.map(a => a.name).join(', ')}`);

    const doRegister = await askYesNo(
      zh ? '注册 JoWork 到这些助手？' : 'Register JoWork with these agents?',
      true,
    );

    if (doRegister) {
      for (const agent of detected) {
        await registerEngine(agent.key);
      }
    }
  } else {
    console.log('');
    console.log(zh
      ? '  未检测到已安装的 AI 助手'
      : '  No AI agents detected');

    const { regMethod } = await inquirer.prompt([{
      type: 'list',
      name: 'regMethod',
      message: zh ? '如何注册？' : 'How to register?',
      choices: [
        { name: zh ? '通过 skills.sh 自动注册（推荐）' : 'Via skills.sh (recommended)', value: 'skills' },
        { name: zh ? '跳过，稍后设置' : 'Skip for now', value: 'skip' },
      ],
    }]);

    if (regMethod === 'skills') {
      console.log(zh ? '\n  正在通过 skills.sh 注册...\n' : '\n  Registering via skills.sh...\n');
      try {
        execSync('npx -y skills add FluxVita/jowork', { stdio: 'inherit' });
      } catch {
        console.log(zh ? '  ⚠ skills.sh 未安装或注册失败' : '  ⚠ skills.sh not installed or failed');
      }
    }
  }

  // ── Step 3: Connect data sources ──
  console.log('');
  console.log(zh
    ? '  接下来连接你的数据源（可选，随时可以添加）'
    : '  Now connect your data sources (optional, can add anytime)');
  console.log('');

  // Check which credentials are available from environment
  const envHints: Record<string, boolean> = {
    feishu: !!(process.env['FEISHU_APP_ID'] && process.env['FEISHU_APP_SECRET']),
    github: !!process.env['GITHUB_PERSONAL_ACCESS_TOKEN'],
  };

  // Multi-select list — same UX as skills.sh
  // Pre-check sources with env vars detected
  const { selectedSources } = await inquirer.prompt([{
    type: 'checkbox',
    name: 'selectedSources',
    message: zh
      ? '选择要连接的数据源（空格选择，回车确认）'
      : 'Select data sources to connect (space to select, enter to confirm)',
    choices: [
      {
        name: zh ? '飞书（消息、会议、文档）' : 'Feishu (messages, meetings, docs)',
        value: 'feishu',
        checked: envHints.feishu,
      },
      {
        name: 'GitHub (repos, issues, PRs)',
        value: 'github',
        checked: envHints.github,
      },
      {
        name: 'GitLab (projects, issues, MRs)',
        value: 'gitlab',
      },
      {
        name: 'Linear (issues)',
        value: 'linear',
      },
      {
        name: zh ? 'PostHog（用户行为数据）' : 'PostHog (analytics)',
        value: 'posthog',
      },
      {
        name: zh ? 'Slack（消息推送）' : 'Slack (notifications)',
        value: 'slack',
      },
      {
        name: zh ? 'Telegram（消息推送）' : 'Telegram (notifications)',
        value: 'telegram',
      },
      {
        name: zh ? 'Firebase（用户行为埋点）' : 'Firebase (analytics events)',
        value: 'firebase',
      },
    ],
  }]);

  for (const key of selectedSources as string[]) {
    await connectSource(key, inquirer);
  }

  // ── Step 4: First sync ──
  const connectedSources = listCredentials();
  if (connectedSources.length > 0) {
    console.log('');
    console.log(zh
      ? `  正在同步 ${connectedSources.length} 个数据源...`
      : `  Syncing ${connectedSources.length} source${connectedSources.length > 1 ? 's' : ''}...`);
    console.log('');

    const { runSync } = await import('./sync.js');
    try {
      await runSync(connectedSources);
    } catch {
      console.log(zh
        ? '  ⚠ 部分数据源同步失败，稍后运行 jowork sync 重试'
        : '  ⚠ Some sources failed to sync. Run `jowork sync` to retry.');
    }
  }

  // ── Done ──
  console.log('');
  console.log('  ─────────────────────────────────────────────────────────────');
  console.log(zh ? '  ✓ JoWork 已就绪！' : '  ✓ JoWork is ready!');
  console.log('');

  if (connectedSources.length > 0) {
    console.log(zh
      ? '  现在可以跟你的 AI 助手对话了，它已经能访问你的数据。'
      : '  You can now talk to your AI agent — it has access to your data.');
    console.log('');
    console.log(zh
      ? '  试试问它："最近飞书群里在讨论什么？"'
      : '  Try asking: "What has the team been discussing?"');
  } else {
    console.log(zh
      ? '  随时运行 jowork connect <数据源> 添加数据。'
      : '  Run `jowork connect <source>` anytime to add data.');
  }

  console.log('');
  console.log(zh ? '  其他命令：' : '  Other commands:');
  console.log(zh
    ? '    jowork dashboard    打开可视化面板'
    : '    jowork dashboard    Open visual dashboard');
  console.log(zh
    ? '    jowork status       查看数据概览'
    : '    jowork status       View data overview');
  console.log(zh
    ? '    jowork --help       查看所有命令'
    : '    jowork --help       All commands');
  console.log('');
}

// ── Auto-detect installed agents ──

interface DetectedAgent {
  key: string;
  name: string;
}

function detectInstalledAgents(): DetectedAgent[] {
  const agents: DetectedAgent[] = [];

  // Claude Code: ~/.claude.json or ~/.claude/ directory
  if (existsSync(join(HOME, '.claude.json')) || existsSync(join(HOME, '.claude'))) {
    agents.push({ key: 'claude-code', name: 'Claude Code' });
  }
  // Codex: ~/.codex/
  if (existsSync(join(HOME, '.codex'))) {
    agents.push({ key: 'codex', name: 'Codex' });
  }
  // Cursor: ~/.cursor/
  if (existsSync(join(HOME, '.cursor'))) {
    agents.push({ key: 'cursor', name: 'Cursor' });
  }
  // OpenClaw: ~/.openclaw/
  if (existsSync(join(HOME, '.openclaw'))) {
    agents.push({ key: 'openclaw', name: 'OpenClaw' });
  }

  return agents;
}

// ── Engine registration ──

async function registerEngine(engine: string): Promise<void> {
  const names: Record<string, string> = {
    'claude-code': 'Claude Code', codex: 'Codex', cursor: 'Cursor', openclaw: 'OpenClaw',
  };

  const mcpEntry = { command: 'jowork', args: ['serve'] };

  switch (engine) {
    case 'claude-code': {
      const p = join(HOME, '.claude.json');
      if (existsSync(p)) copyFileSync(p, p + '.bak');
      let cfg: Record<string, unknown> = {};
      if (existsSync(p)) { try { cfg = JSON.parse(readFileSync(p, 'utf-8')); } catch { cfg = {}; } }
      if (!cfg.mcpServers) cfg.mcpServers = {};
      (cfg.mcpServers as Record<string, unknown>)['jowork'] = mcpEntry;
      writeFileSync(p, JSON.stringify(cfg, null, 2));
      break;
    }
    case 'codex': {
      const dir = join(HOME, '.codex');
      mkdirSync(dir, { recursive: true });
      const p = join(dir, 'config.toml');
      let c = existsSync(p) ? readFileSync(p, 'utf-8') : '';
      if (!c.includes('[mcp_servers.jowork]')) {
        c += '\n[mcp_servers.jowork]\ncommand = "jowork"\nargs = ["serve"]\n';
        writeFileSync(p, c);
      }
      break;
    }
    case 'cursor': {
      const dir = join(HOME, '.cursor');
      mkdirSync(dir, { recursive: true });
      const p = join(dir, 'mcp.json');
      let cfg: Record<string, unknown> = {};
      if (existsSync(p)) { try { cfg = JSON.parse(readFileSync(p, 'utf-8')); } catch { cfg = {}; } }
      if (!cfg.mcpServers) cfg.mcpServers = {};
      (cfg.mcpServers as Record<string, unknown>)['jowork'] = mcpEntry;
      writeFileSync(p, JSON.stringify(cfg, null, 2));
      break;
    }
    case 'openclaw': {
      const dir = join(HOME, '.openclaw');
      mkdirSync(dir, { recursive: true });
      const p = join(dir, 'config.json');
      let cfg: Record<string, unknown> = {};
      if (existsSync(p)) { try { cfg = JSON.parse(readFileSync(p, 'utf-8')); } catch { cfg = {}; } }
      if (!cfg.mcpServers) cfg.mcpServers = {};
      (cfg.mcpServers as Record<string, unknown>)['jowork'] = mcpEntry;
      writeFileSync(p, JSON.stringify(cfg, null, 2));
      break;
    }
  }
  console.log(zh ? `  ✓ 已注册到 ${names[engine] ?? engine}` : `  ✓ Registered with ${names[engine] ?? engine}`);
}

// ── Retry helper ──

async function askRetryOrSkip(): Promise<boolean> {
  const { action } = await _inquirer.prompt([{
    type: 'list',
    name: 'action',
    message: zh ? '怎么处理？' : 'What to do?',
    choices: [
      { name: zh ? '重新输入' : 'Retry', value: 'retry' },
      { name: zh ? '跳过' : 'Skip', value: 'skip' },
    ],
  }]);
  return action === 'retry';
}

// ── Data source connection ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connectSource(source: string, inquirer: any): Promise<void> {
  const titles: Record<string, string> = {
    feishu: zh ? '── 飞书 ──' : '── Feishu ──',
    github: '── GitHub ──',
    gitlab: '── GitLab ──',
    linear: '── Linear ──',
    posthog: '── PostHog ──',
    slack: '── Slack ──',
    telegram: '── Telegram ──',
    firebase: '── Firebase ──',
  };
  console.log(`\n  ${titles[source] ?? source}`);

  switch (source) {
    case 'feishu': {
      let done = false;
      while (!done) {
        let appId = process.env['FEISHU_APP_ID'];
        let appSecret = process.env['FEISHU_APP_SECRET'];

        if (appId && appSecret) {
          console.log(zh ? '  从环境变量读取飞书凭证...' : '  Reading Feishu credentials from env...');
        } else {
          console.log(zh
            ? '  需要 App ID 和 App Secret\n  获取方式：https://open.feishu.cn/app → 创建应用 → 凭证'
            : '  Requires App ID and App Secret\n  Get them: https://open.feishu.cn/app → Create App → Credentials');
          console.log('');
          const answers = await inquirer.prompt([
            { type: 'input', name: 'appId', message: zh ? '飞书 App ID (cli_xxx):' : 'Feishu App ID (cli_xxx):', when: !appId },
            { type: 'input', name: 'appSecret', message: zh ? '飞书 App Secret:' : 'Feishu App Secret:', when: !appSecret },
          ]);
          appId = appId ?? answers.appId;
          appSecret = appSecret ?? answers.appSecret;
        }

        if (!appId || !appSecret) { done = true; break; }

        console.log(zh ? '  验证中...' : '  Verifying...');
        try {
          const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
          });
          const data = await res.json() as { code: number };
          if (data.code === 0) {
            saveCredential('feishu', { type: 'feishu', data: { appId, appSecret }, createdAt: Date.now(), updatedAt: Date.now() });
            console.log(zh ? '  ✓ 飞书已连接（验证通过）' : '  ✓ Feishu connected (verified)');
            done = true;
          } else {
            console.log(zh ? '  ✗ 飞书凭证无效' : '  ✗ Invalid Feishu credentials');
            if (!(await askRetryOrSkip())) done = true;
            else { process.env['FEISHU_APP_ID'] = ''; process.env['FEISHU_APP_SECRET'] = ''; }
          }
        } catch {
          console.log(zh ? '  ✗ 无法连接飞书 API' : '  ✗ Cannot reach Feishu API');
          if (!(await askRetryOrSkip())) done = true;
        }
      }
      break;
    }
    case 'github': {
      let done = false;
      while (!done) {
        let token = process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];

        if (token) {
          console.log(zh ? '  从环境变量读取 GitHub Token...' : '  Reading GitHub token from env...');
        } else {
          console.log(zh
            ? '  需要 Personal Access Token\n  创建方式：https://github.com/settings/tokens → Generate new token'
            : '  Requires a Personal Access Token\n  Create at: https://github.com/settings/tokens');
          console.log('');
          const answers = await inquirer.prompt([
            { type: 'input', name: 'token', message: 'GitHub Token (ghp_xxx):' },
          ]);
          token = answers.token;
        }

        if (!token) { done = true; break; }

        console.log(zh ? '  验证中...' : '  Verifying...');
        try {
          const res = await fetch('https://api.github.com/user', {
            headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'jowork' },
          });
          if (res.ok) {
            const user = await res.json() as { login: string };
            saveCredential('github', { type: 'github', data: { token }, createdAt: Date.now(), updatedAt: Date.now() });
            console.log(zh ? `  ✓ GitHub 已连接（用户：${user.login}）` : `  ✓ GitHub connected (user: ${user.login})`);
            done = true;
          } else {
            console.log(zh ? '  ✗ GitHub Token 无效' : '  ✗ Invalid GitHub token');
            if (!(await askRetryOrSkip())) done = true;
            else process.env['GITHUB_PERSONAL_ACCESS_TOKEN'] = '';
          }
        } catch {
          console.log(zh ? '  ✗ 无法连接 GitHub API' : '  ✗ Cannot reach GitHub API');
          if (!(await askRetryOrSkip())) done = true;
        }
      }
      break;
    }
    case 'gitlab': {
      let done = false;
      while (!done) {
        console.log(zh
          ? '  需要 Personal Access Token\n  创建方式：GitLab → Settings → Access Tokens'
          : '  Requires a Personal Access Token\n  Create at: GitLab → Settings → Access Tokens');
        console.log('');
        const glAnswers = await inquirer.prompt([
          { type: 'input', name: 'token', message: 'GitLab Token (glpat-xxx):' },
          { type: 'input', name: 'apiUrl', message: zh ? 'GitLab 地址（默认 https://gitlab.com）:' : 'GitLab URL (default: https://gitlab.com):', default: 'https://gitlab.com' },
        ]);
        if (!glAnswers.token) { done = true; break; }

        console.log(zh ? '  验证中...' : '  Verifying...');
        try {
          const res = await fetch(`${glAnswers.apiUrl}/api/v4/user`, {
            headers: { 'PRIVATE-TOKEN': glAnswers.token },
          });
          if (res.ok) {
            const user = await res.json() as { username: string };
            saveCredential('gitlab', { type: 'gitlab', data: { token: glAnswers.token, apiUrl: glAnswers.apiUrl }, createdAt: Date.now(), updatedAt: Date.now() });
            console.log(zh ? `  ✓ GitLab 已连接（用户：${user.username}）` : `  ✓ GitLab connected (user: ${user.username})`);
            done = true;
          } else {
            console.log(zh ? '  ✗ GitLab Token 无效' : '  ✗ Invalid GitLab token');
            if (!(await askRetryOrSkip())) done = true;
          }
        } catch {
          console.log(zh ? '  ✗ 无法连接 GitLab API' : '  ✗ Cannot reach GitLab API');
          if (!(await askRetryOrSkip())) done = true;
        }
      }
      break;
    }
    case 'linear': {
      let done = false;
      while (!done) {
        console.log(zh
          ? '  需要 API Key\n  获取方式：Linear → Settings → API → Personal API keys'
          : '  Requires an API key\n  Get it: Linear → Settings → API → Personal API keys');
        console.log('');
        const linAnswers = await inquirer.prompt([
          { type: 'input', name: 'apiKey', message: 'Linear API Key (lin_api_xxx):' },
        ]);
        if (!linAnswers.apiKey) { done = true; break; }

        console.log(zh ? '  验证中...' : '  Verifying...');
        try {
          const res = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: linAnswers.apiKey },
            body: JSON.stringify({ query: '{ viewer { name } }' }),
          });
          if (res.ok) {
            const data = await res.json() as { data?: { viewer?: { name: string } } };
            const name = data.data?.viewer?.name ?? 'unknown';
            saveCredential('linear', { type: 'linear', data: { apiKey: linAnswers.apiKey }, createdAt: Date.now(), updatedAt: Date.now() });
            console.log(zh ? `  ✓ Linear 已连接（用户：${name}）` : `  ✓ Linear connected (user: ${name})`);
            done = true;
          } else {
            console.log(zh ? '  ✗ Linear API Key 无效' : '  ✗ Invalid Linear API key');
            if (!(await askRetryOrSkip())) done = true;
          }
        } catch {
          console.log(zh ? '  ✗ 无法连接 Linear API' : '  ✗ Cannot reach Linear API');
          if (!(await askRetryOrSkip())) done = true;
        }
      }
      break;
    }
    case 'posthog': {
      let done = false;
      while (!done) {
        console.log(zh
          ? '  需要 Personal API Key\n  获取方式：PostHog → Settings → Personal API Keys'
          : '  Requires a Personal API key\n  Get it: PostHog → Settings → Personal API Keys');
        console.log('');
        const phAnswers = await inquirer.prompt([
          { type: 'input', name: 'apiKey', message: 'PostHog API Key (phx_xxx):' },
          { type: 'input', name: 'host', message: zh ? 'PostHog 地址（默认 https://app.posthog.com）:' : 'PostHog host (default: https://app.posthog.com):', default: 'https://app.posthog.com' },
        ]);
        if (!phAnswers.apiKey) { done = true; break; }

        console.log(zh ? '  验证中...' : '  Verifying...');
        try {
          const res = await fetch(`${phAnswers.host}/api/projects/`, {
            headers: { Authorization: `Bearer ${phAnswers.apiKey}` },
          });
          if (res.ok) {
            saveCredential('posthog', { type: 'posthog', data: { apiKey: phAnswers.apiKey, host: phAnswers.host, projectId: '1' }, createdAt: Date.now(), updatedAt: Date.now() });
            console.log(zh ? '  ✓ PostHog 已连接（验证通过）' : '  ✓ PostHog connected (verified)');
            done = true;
          } else {
            console.log(zh ? '  ✗ PostHog API Key 无效' : '  ✗ Invalid PostHog API key');
            if (!(await askRetryOrSkip())) done = true;
          }
        } catch {
          console.log(zh ? '  ✗ 无法连接 PostHog API' : '  ✗ Cannot reach PostHog API');
          if (!(await askRetryOrSkip())) done = true;
        }
      }
      break;
    }
    case 'slack': {
      console.log(zh
        ? '  需要 Incoming Webhook URL\n  创建方式：https://api.slack.com/messaging/webhooks'
        : '  Requires an Incoming Webhook URL\n  Create at: https://api.slack.com/messaging/webhooks');
      console.log('');
      const slackAnswers = await inquirer.prompt([
        { type: 'input', name: 'webhookUrl', message: 'Slack Webhook URL (https://hooks.slack.com/...):' },
      ]);
      if (slackAnswers.webhookUrl) {
        saveCredential('slack', { type: 'slack', data: { webhookUrl: slackAnswers.webhookUrl }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(zh ? '  ✓ Slack 已连接' : '  ✓ Slack connected');
      }
      break;
    }
    case 'telegram': {
      console.log(zh
        ? '  需要 Bot Token 和 Chat ID\n  创建方式：在 Telegram 中搜索 @BotFather → /newbot'
        : '  Requires Bot Token and Chat ID\n  Create: search @BotFather in Telegram → /newbot');
      console.log('');
      const tgAnswers = await inquirer.prompt([
        { type: 'input', name: 'botToken', message: zh ? 'Telegram Bot Token (123456:ABC-xxx):' : 'Telegram Bot Token (123456:ABC-xxx):' },
        { type: 'input', name: 'chatId', message: zh ? 'Telegram Chat ID:' : 'Telegram Chat ID:' },
      ]);
      if (tgAnswers.botToken) {
        console.log(zh ? '  验证中...' : '  Verifying...');
        try {
          const res = await fetch(`https://api.telegram.org/bot${tgAnswers.botToken}/getMe`);
          const data = await res.json() as { ok: boolean; result?: { username: string } };
          if (data.ok) {
            saveCredential('telegram', { type: 'telegram', data: { botToken: tgAnswers.botToken, chatId: tgAnswers.chatId ?? '' }, createdAt: Date.now(), updatedAt: Date.now() });
            console.log(zh ? `  ✓ Telegram 已连接（Bot: @${data.result?.username}）` : `  ✓ Telegram connected (Bot: @${data.result?.username})`);
          } else {
            console.log(zh ? '  ✗ Telegram Bot Token 无效' : '  ✗ Invalid Telegram Bot Token');
          }
        } catch {
          console.log(zh ? '  ✗ 无法连接 Telegram API' : '  ✗ Cannot reach Telegram API');
        }
      }
      break;
    }
    case 'firebase': {
      console.log(zh
        ? '  需要 Google Analytics API Key 和 Property ID\n  获取方式：Google Cloud Console → APIs & Services → Credentials'
        : '  Requires Google Analytics API Key and Property ID\n  Get it: Google Cloud Console → APIs & Services → Credentials');
      console.log('');
      const fbAnswers = await inquirer.prompt([
        { type: 'input', name: 'apiKey', message: zh ? 'Firebase/GA4 API Key:' : 'Firebase/GA4 API Key:' },
        { type: 'input', name: 'propertyId', message: zh ? 'GA4 Property ID (数字):' : 'GA4 Property ID (numbers):' },
      ]);
      if (fbAnswers.apiKey && fbAnswers.propertyId) {
        saveCredential('firebase', { type: 'firebase', data: { apiKey: fbAnswers.apiKey, projectId: fbAnswers.propertyId, propertyId: fbAnswers.propertyId }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(zh ? '  ✓ Firebase 已连接' : '  ✓ Firebase connected');
      }
      break;
    }
  }
}
