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

// ── Setup Wizard ──

export async function runSetupWizard(): Promise<void> {
  const { default: inquirer } = await import('inquirer');

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

    const { doRegister } = await inquirer.prompt([{
      type: 'confirm',
      name: 'doRegister',
      message: zh ? '注册 JoWork 到这些助手？' : 'Register JoWork with these agents?',
      default: true,
    }]);

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

  // Auto-detect available credentials from environment
  const autoDetected: Array<{ key: string; label: string; envHint: string }> = [];
  if (process.env['FEISHU_APP_ID'] && process.env['FEISHU_APP_SECRET']) {
    autoDetected.push({ key: 'feishu', label: zh ? '飞书' : 'Feishu', envHint: 'FEISHU_APP_ID' });
  }
  if (process.env['GITHUB_PERSONAL_ACCESS_TOKEN']) {
    autoDetected.push({ key: 'github', label: 'GitHub', envHint: 'GITHUB_PERSONAL_ACCESS_TOKEN' });
  }

  // If env vars detected, auto-connect them
  if (autoDetected.length > 0) {
    console.log(zh
      ? `  检测到环境变量中的凭证：${autoDetected.map(d => d.label).join('、')}`
      : `  Detected credentials in environment: ${autoDetected.map(d => d.label).join(', ')}`);

    const { autoConnect } = await inquirer.prompt([{
      type: 'confirm',
      name: 'autoConnect',
      message: zh ? '自动连接这些数据源？' : 'Auto-connect these sources?',
      default: true,
    }]);

    if (autoConnect) {
      for (const src of autoDetected) {
        await connectSource(src.key, inquirer);
      }
    }
  }

  // Ask about additional sources not auto-detected
  const alreadyConnected = new Set([...listCredentials(), ...autoDetected.map(d => d.key)]);
  const remaining = [
    { key: 'feishu', label: zh ? '飞书（消息、会议、文档）' : 'Feishu (messages, meetings, docs)' },
    { key: 'github', label: 'GitHub (repos, issues, PRs)' },
    { key: 'gitlab', label: 'GitLab (projects, issues, MRs)' },
    { key: 'linear', label: 'Linear (issues)' },
    { key: 'posthog', label: zh ? 'PostHog（用户行为数据）' : 'PostHog (analytics)' },
  ].filter(s => !alreadyConnected.has(s.key));

  if (remaining.length > 0) {
    const { addMore } = await inquirer.prompt([{
      type: 'confirm',
      name: 'addMore',
      message: zh ? '要连接其他数据源吗？' : 'Connect additional data sources?',
      default: false,
    }]);

    if (addMore) {
      for (const ds of remaining) {
        const { yes } = await inquirer.prompt([{
          type: 'confirm',
          name: 'yes',
          message: zh ? `  连接 ${ds.label}？` : `  Connect ${ds.label}?`,
          default: false,
        }]);
        if (yes) await connectSource(ds.key, inquirer);
      }
    }
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

// ── Data source connection ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connectSource(source: string, inquirer: any): Promise<void> {
  switch (source) {
    case 'feishu': {
      let appId = process.env['FEISHU_APP_ID'];
      let appSecret = process.env['FEISHU_APP_SECRET'];

      if (appId && appSecret) {
        console.log(zh ? '  从环境变量读取飞书凭证...' : '  Reading Feishu credentials from env...');
      } else {
        console.log('');
        console.log(zh
          ? '  飞书连接需要 App ID 和 App Secret\n  获取方式：https://open.feishu.cn/app → 创建应用 → 凭证'
          : '  Feishu requires App ID and App Secret\n  Get them: https://open.feishu.cn/app → Create App → Credentials');
        console.log('');

        const answers = await inquirer.prompt([
          { type: 'input', name: 'appId', message: zh ? '飞书 App ID:' : 'Feishu App ID:', when: !appId },
          { type: 'password', name: 'appSecret', message: zh ? '飞书 App Secret:' : 'Feishu App Secret:', when: !appSecret },
        ]);
        appId = appId ?? answers.appId;
        appSecret = appSecret ?? answers.appSecret;
      }

      if (appId && appSecret) {
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
            console.log(zh ? '  ✓ 飞书已连接' : '  ✓ Feishu connected');
          } else {
            console.log(zh ? '  ✗ 飞书凭证无效' : '  ✗ Invalid Feishu credentials');
          }
        } catch {
          console.log(zh ? '  ✗ 无法连接飞书 API' : '  ✗ Cannot reach Feishu API');
        }
      }
      break;
    }
    case 'github': {
      let token = process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];

      if (token) {
        console.log(zh ? '  从环境变量读取 GitHub Token...' : '  Reading GitHub token from env...');
      } else {
        console.log('');
        console.log(zh
          ? '  GitHub 连接需要 Personal Access Token\n  创建方式：https://github.com/settings/tokens → Generate new token'
          : '  GitHub requires a Personal Access Token\n  Create at: https://github.com/settings/tokens');
        console.log('');
        const answers = await inquirer.prompt([
          { type: 'password', name: 'token', message: 'GitHub Token:' },
        ]);
        token = answers.token;
      }

      if (token) {
        saveCredential('github', { type: 'github', data: { token }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(zh ? '  ✓ GitHub 已连接' : '  ✓ GitHub connected');
      }
      break;
    }
    case 'gitlab': {
      console.log('');
      console.log(zh
        ? '  GitLab 连接需要 Personal Access Token\n  创建方式：GitLab → Settings → Access Tokens'
        : '  GitLab requires a Personal Access Token\n  Create at: GitLab → Settings → Access Tokens');
      console.log('');
      const answers = await inquirer.prompt([
        { type: 'password', name: 'token', message: 'GitLab Token:' },
        { type: 'input', name: 'apiUrl', message: zh ? 'GitLab 地址（默认 https://gitlab.com）:' : 'GitLab URL (default: https://gitlab.com):', default: 'https://gitlab.com' },
      ]);
      if (answers.token) {
        saveCredential('gitlab', { type: 'gitlab', data: { token: answers.token, apiUrl: answers.apiUrl }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(zh ? '  ✓ GitLab 已连接' : '  ✓ GitLab connected');
      }
      break;
    }
    case 'linear': {
      console.log('');
      console.log(zh
        ? '  Linear 连接需要 API Key\n  获取方式：Linear → Settings → API → Personal API keys'
        : '  Linear requires an API key\n  Get it: Linear → Settings → API → Personal API keys');
      console.log('');
      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'Linear API Key:' },
      ]);
      if (answers.apiKey) {
        saveCredential('linear', { type: 'linear', data: { apiKey: answers.apiKey }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(zh ? '  ✓ Linear 已连接' : '  ✓ Linear connected');
      }
      break;
    }
    case 'posthog': {
      console.log('');
      console.log(zh
        ? '  PostHog 连接需要 Personal API Key\n  获取方式：PostHog → Settings → Personal API Keys'
        : '  PostHog requires a Personal API key\n  Get it: PostHog → Settings → Personal API Keys');
      console.log('');
      const answers = await inquirer.prompt([
        { type: 'password', name: 'apiKey', message: 'PostHog API Key:' },
        { type: 'input', name: 'host', message: zh ? 'PostHog 地址（默认 https://app.posthog.com）:' : 'PostHog host (default: https://app.posthog.com):', default: 'https://app.posthog.com' },
      ]);
      if (answers.apiKey) {
        saveCredential('posthog', { type: 'posthog', data: { apiKey: answers.apiKey, host: answers.host, projectId: '1' }, createdAt: Date.now(), updatedAt: Date.now() });
        console.log(zh ? '  ✓ PostHog 已连接' : '  ✓ PostHog connected');
      }
      break;
    }
  }
}
