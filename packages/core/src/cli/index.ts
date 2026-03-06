#!/usr/bin/env node
/**
 * jowork CLI — Agent-operable connector management
 *
 * 模仿 Vercel CLI 的 integration 子命令体系，让 AI Agent 可以：
 *   jowork connector list          — 发现所有可用连接器及配置状态
 *   jowork connector guide <name>  — 获取连接器接入指引和所需 env var
 *   jowork connector check <name>  — 检查连接器环境变量是否已配置
 *   jowork status                  — 检测 Gateway 是否运行
 *   jowork version                 — 显示版本
 *
 * 目标：让 Agent 无需读文档，直接通过 CLI 完成 JoWork 基础设施配置。
 */

import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ─── 连接器元数据 ─────────────────────────────────────────
interface ConnectorMeta {
  id: string;
  displayName: string;
  description: string;
  envVars: { key: string; description: string; required: boolean }[];
  setupSteps: string[];
  docsUrl?: string;
}

const CONNECTORS: ConnectorMeta[] = [
  {
    id: 'gitlab',
    displayName: 'GitLab',
    description: '代码仓库同步，支持 MR、Issue、代码搜索',
    envVars: [
      { key: 'GITLAB_URL',          description: 'GitLab 实例地址（如 https://gitlab.com）', required: true },
      { key: 'GITLAB_TOKEN',        description: 'Personal Access Token（api + read_repository 权限）', required: true },
      { key: 'GITLAB_PROJECT_IDS',  description: '要同步的项目 ID，逗号分隔（如 123,456）', required: false },
    ],
    setupSteps: [
      '1. 访问 GitLab → Settings → Access Tokens',
      '2. 创建 Token，勾选 api + read_repository 权限',
      '3. 将 Token 写入 GITLAB_TOKEN 环境变量',
      '4. 将 GitLab 实例地址写入 GITLAB_URL（默认 https://gitlab.com）',
      '5. 可选：在 GITLAB_PROJECT_IDS 指定要同步的项目 ID',
    ],
    docsUrl: 'https://docs.gitlab.com/ee/user/profile/personal_access_tokens.html',
  },
  {
    id: 'linear',
    displayName: 'Linear',
    description: '项目管理同步，支持 Issue、项目、成员',
    envVars: [
      { key: 'LINEAR_API_KEY', description: 'Linear API Key（Personal API Keys 页面生成）', required: true },
    ],
    setupSteps: [
      '1. 访问 Linear → Settings → API → Personal API Keys',
      '2. 点击 Create new API key，复制 Key',
      '3. 将 Key 写入 LINEAR_API_KEY 环境变量',
    ],
    docsUrl: 'https://linear.app/docs/graphql/working-with-the-graphql-api',
  },
  {
    id: 'github',
    displayName: 'GitHub',
    description: '代码仓库同步（公开和私有），支持 PR、Issue、代码搜索',
    envVars: [
      { key: 'GITHUB_TOKEN', description: 'GitHub Personal Access Token（repo 权限）', required: true },
      { key: 'GITHUB_ORGS',  description: '要同步的 org 名称，逗号分隔（可选）', required: false },
    ],
    setupSteps: [
      '1. 访问 GitHub → Settings → Developer settings → Personal access tokens',
      '2. 创建 Fine-grained token 或 Classic token，勾选 repo 权限',
      '3. 将 Token 写入 GITHUB_TOKEN 环境变量',
    ],
    docsUrl: 'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token',
  },
  {
    id: 'notion',
    displayName: 'Notion',
    description: 'Notion 工作空间同步，支持 Database、Page 搜索',
    envVars: [
      { key: 'NOTION_TOKEN', description: 'Notion Integration Token（Internal Integration）', required: true },
    ],
    setupSteps: [
      '1. 访问 https://www.notion.so/my-integrations',
      '2. 点击 + New integration，创建 Internal Integration',
      '3. 复制 Internal Integration Token',
      '4. 将 Token 写入 NOTION_TOKEN 环境变量',
      '5. 在 Notion 中，把需要同步的页面 Share → Invite 你的 Integration',
    ],
    docsUrl: 'https://developers.notion.com/docs/create-a-notion-integration',
  },
  {
    id: 'slack',
    displayName: 'Slack',
    description: 'Slack 频道消息同步和发送',
    envVars: [
      { key: 'SLACK_BOT_TOKEN',    description: 'Bot User OAuth Token（xoxb-...）', required: true },
      { key: 'SLACK_CHANNEL_IDS',  description: '要同步的 Channel ID，逗号分隔（可选，默认全部）', required: false },
    ],
    setupSteps: [
      '1. 访问 https://api.slack.com/apps → Create New App',
      '2. 选择 From scratch，配置权限：channels:history, channels:read, chat:write, users:read',
      '3. Install to Workspace，复制 Bot User OAuth Token',
      '4. 将 Token 写入 SLACK_BOT_TOKEN 环境变量',
    ],
    docsUrl: 'https://api.slack.com/quickstart',
  },
  {
    id: 'figma',
    displayName: 'Figma',
    description: 'Figma 设计文件同步，支持组件、变量搜索',
    envVars: [
      { key: 'FIGMA_TOKEN',     description: 'Figma Personal Access Token', required: true },
      { key: 'FIGMA_FILE_KEYS', description: '要同步的文件 Key，逗号分隔（可选）', required: false },
    ],
    setupSteps: [
      '1. 访问 Figma → Account Settings → Personal access tokens',
      '2. 点击 Generate new token，复制 Token',
      '3. 将 Token 写入 FIGMA_TOKEN 环境变量',
    ],
    docsUrl: 'https://www.figma.com/developers/api#authentication',
  },
  {
    id: 'jira',
    displayName: 'Jira',
    description: 'Jira Issue 和项目同步',
    envVars: [
      { key: 'JIRA_HOST',     description: 'Jira 实例地址（如 your-org.atlassian.net）', required: true },
      { key: 'JIRA_EMAIL',    description: '你的 Atlassian 账号邮箱', required: true },
      { key: 'JIRA_API_TOKEN', description: 'Atlassian API Token', required: true },
    ],
    setupSteps: [
      '1. 访问 https://id.atlassian.com/manage-profile/security/api-tokens',
      '2. 点击 Create API token，复制 Token',
      '3. 将邮箱写入 JIRA_EMAIL，Token 写入 JIRA_API_TOKEN，域名写入 JIRA_HOST',
    ],
    docsUrl: 'https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/',
  },
  {
    id: 'confluence',
    displayName: 'Confluence',
    description: 'Confluence 知识库文档同步',
    envVars: [
      { key: 'CONFLUENCE_HOST',      description: 'Confluence 实例地址（如 your-org.atlassian.net）', required: true },
      { key: 'CONFLUENCE_EMAIL',     description: '你的 Atlassian 账号邮箱', required: true },
      { key: 'CONFLUENCE_API_TOKEN', description: 'Atlassian API Token（同 Jira）', required: true },
      { key: 'CONFLUENCE_SPACE_KEYS', description: '要同步的 Space Key，逗号分隔（可选）', required: false },
    ],
    setupSteps: [
      '1. 访问 https://id.atlassian.com/manage-profile/security/api-tokens',
      '2. 点击 Create API token，复制 Token',
      '3. 配置 CONFLUENCE_HOST、CONFLUENCE_EMAIL、CONFLUENCE_API_TOKEN',
    ],
    docsUrl: 'https://developer.atlassian.com/cloud/confluence/rest/v1/intro/',
  },
  {
    id: 'email',
    displayName: 'Email (IMAP)',
    description: '邮箱同步（支持 Gmail、QQ、Outlook 等 IMAP 邮箱）',
    envVars: [
      { key: 'EMAIL_HOST',     description: 'IMAP 服务器地址（如 imap.gmail.com）', required: true },
      { key: 'EMAIL_PORT',     description: 'IMAP 端口（默认 993）', required: false },
      { key: 'EMAIL_USER',     description: '邮箱地址', required: true },
      { key: 'EMAIL_PASSWORD', description: '邮箱密码或应用专用密码', required: true },
    ],
    setupSteps: [
      '1. Gmail：开启两步验证 → 生成应用专用密码，IMAP 地址 imap.gmail.com',
      '2. Outlook/Exchange：IMAP 地址 outlook.office365.com',
      '3. QQ 邮箱：开启 IMAP，获取授权码，IMAP 地址 imap.qq.com',
      '4. 配置 EMAIL_HOST、EMAIL_USER、EMAIL_PASSWORD',
    ],
    docsUrl: 'https://support.google.com/mail/answer/7126229',
  },
  {
    id: 'discord',
    displayName: 'Discord',
    description: 'Discord 服务器消息同步',
    envVars: [
      { key: 'DISCORD_BOT_TOKEN', description: 'Discord Bot Token', required: true },
      { key: 'DISCORD_GUILD_IDS', description: '要同步的 Guild（服务器）ID，逗号分隔（可选）', required: false },
    ],
    setupSteps: [
      '1. 访问 https://discord.com/developers/applications → New Application',
      '2. 进入 Bot 选项卡 → Add Bot → 复制 Token',
      '3. 在 OAuth2 → URL Generator，勾选 bot + Read Message History，生成邀请链接',
      '4. 将 Bot 邀请到你的服务器，配置 DISCORD_BOT_TOKEN',
    ],
    docsUrl: 'https://discord.com/developers/docs/getting-started',
  },
  {
    id: 'google',
    displayName: 'Google (Drive / Docs / Calendar / Gmail)',
    description: 'Google Workspace 全套同步（Drive、Docs、Calendar、Gmail）',
    envVars: [
      { key: 'GOOGLE_CLIENT_ID',     description: 'Google OAuth Client ID', required: true },
      { key: 'GOOGLE_CLIENT_SECRET', description: 'Google OAuth Client Secret', required: true },
      { key: 'GOOGLE_REDIRECT_URI',  description: 'OAuth 回调地址（如 http://localhost:18800/api/oauth/callback/google）', required: true },
    ],
    setupSteps: [
      '1. 访问 https://console.cloud.google.com → 创建项目',
      '2. 启用 Google Drive API、Gmail API、Google Calendar API、Google Docs API',
      '3. 创建 OAuth 2.0 Client ID（Web Application），添加回调地址',
      '4. 复制 Client ID 和 Client Secret，配置相应环境变量',
      '5. 在 JoWork Admin → Data Sources 完成 OAuth 授权',
    ],
    docsUrl: 'https://developers.google.com/workspace/guides/create-credentials',
  },
  {
    id: 'outlook',
    displayName: 'Outlook / Microsoft 365',
    description: 'Outlook 邮件和日历同步（Microsoft 365）',
    envVars: [
      { key: 'OUTLOOK_CLIENT_ID',     description: 'Azure App Client ID', required: true },
      { key: 'OUTLOOK_CLIENT_SECRET', description: 'Azure App Client Secret', required: true },
      { key: 'OUTLOOK_TENANT_ID',     description: 'Azure Tenant ID（企业版）或 common（个人版）', required: true },
    ],
    setupSteps: [
      '1. 访问 https://portal.azure.com → Azure Active Directory → App Registrations → New',
      '2. 配置 Redirect URI 为 http://localhost:18800/api/oauth/callback/outlook',
      '3. 在 Certificates & secrets 创建 Client Secret',
      '4. 配置 OUTLOOK_CLIENT_ID、OUTLOOK_CLIENT_SECRET、OUTLOOK_TENANT_ID',
    ],
    docsUrl: 'https://learn.microsoft.com/en-us/azure/active-directory/develop/quickstart-register-app',
  },
  {
    id: 'telegram',
    displayName: 'Telegram',
    description: 'Telegram 频道/群组消息同步',
    envVars: [
      { key: 'TELEGRAM_BOT_TOKEN', description: 'Telegram Bot Token（从 @BotFather 获取）', required: true },
      { key: 'TELEGRAM_CHAT_IDS',  description: '要同步的 Chat ID，逗号分隔（可选）', required: false },
    ],
    setupSteps: [
      '1. 在 Telegram 搜索 @BotFather，发送 /newbot',
      '2. 按提示设置 Bot 名称和用户名，获取 Token',
      '3. 配置 TELEGRAM_BOT_TOKEN',
      '4. 将 Bot 添加到要同步的群/频道（设为管理员），获取 Chat ID',
    ],
    docsUrl: 'https://core.telegram.org/bots/tutorial',
  },
];

// ─── 工具函数 ─────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:  '\x1b[36m',
  red:   '\x1b[31m',
  white: '\x1b[37m',
};

function print(msg: string) { process.stdout.write(msg + '\n'); }

function findConnector(id: string): ConnectorMeta | undefined {
  const lower = id.toLowerCase();
  return CONNECTORS.find(c => c.id === lower || c.displayName.toLowerCase() === lower);
}

function checkEnvVars(meta: ConnectorMeta): { key: string; configured: boolean; required: boolean }[] {
  return meta.envVars.map(v => ({
    key: v.key,
    configured: !!process.env[v.key],
    required: v.required,
  }));
}

// ─── 命令实现 ─────────────────────────────────────────────

function cmdVersion() {
  const pkgPath = resolve(__dirname, '../../package.json');
  try {
    const pkg = require(pkgPath);
    print(`jowork-cli v${pkg.version}`);
  } catch {
    print('jowork-cli v0.1.0');
  }
}

async function cmdStatus(gatewayUrl: string) {
  print(`${C.dim}Checking JoWork Gateway at ${gatewayUrl}...${C.reset}`);
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const r = await fetch(`${gatewayUrl}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const data = await r.json().catch(() => ({})) as Record<string, unknown>;
      print(`${C.green}✓ Gateway is running${C.reset}`);
      print(`  URL:     ${gatewayUrl}`);
      if (data['version']) print(`  Version: ${data['version']}`);
      if (data['uptime'])  print(`  Uptime:  ${Math.round(Number(data['uptime']) / 60)}min`);
    } else {
      print(`${C.yellow}⚠ Gateway responded with ${r.status}${C.reset}`);
    }
  } catch {
    print(`${C.red}✗ Gateway not reachable at ${gatewayUrl}${C.reset}`);
    print(`  Make sure JoWork is running: ${C.dim}npm start${C.reset}`);
  }
}

function cmdConnectorList() {
  print(`\n${C.bold}Available JoWork Connectors${C.reset}\n`);
  print(`${'ID'.padEnd(14)} ${'Name'.padEnd(24)} ${'Config Status'.padEnd(16)} Description`);
  print('─'.repeat(88));

  for (const c of CONNECTORS) {
    const checks = checkEnvVars(c);
    const requiredConfigured = checks.filter(x => x.required && x.configured).length;
    const requiredTotal = checks.filter(x => x.required).length;

    let status: string;
    if (requiredTotal === 0) {
      status = `${C.dim}no config needed${C.reset}`;
    } else if (requiredConfigured === requiredTotal) {
      status = `${C.green}✓ configured${C.reset}`;
    } else if (requiredConfigured > 0) {
      status = `${C.yellow}~ partial (${requiredConfigured}/${requiredTotal})${C.reset}`;
    } else {
      status = `${C.dim}not configured${C.reset}`;
    }

    // pad without ANSI codes for alignment
    const idCol = c.id.padEnd(14);
    const nameCol = c.displayName.padEnd(24);
    print(`${idCol} ${nameCol} ${status}`);
    print(`${' '.repeat(39)}${C.dim}${c.description}${C.reset}`);
  }

  print(`\n${C.dim}Use: jowork connector guide <id>   — setup instructions`);
  print(`     jowork connector check <id>   — check env vars${C.reset}\n`);
}

function cmdConnectorGuide(id: string) {
  const meta = findConnector(id);
  if (!meta) {
    print(`${C.red}Unknown connector: ${id}${C.reset}`);
    print(`Run ${C.cyan}jowork connector list${C.reset} to see available connectors.`);
    process.exit(1);
  }

  print(`\n${C.bold}${meta.displayName} — Setup Guide${C.reset}`);
  print(`${C.dim}${meta.description}${C.reset}\n`);

  print(`${C.bold}Required Environment Variables:${C.reset}`);
  for (const v of meta.envVars) {
    const label = v.required ? `${C.cyan}[required]${C.reset}` : `${C.dim}[optional]${C.reset}`;
    print(`  ${label} ${C.bold}${v.key}${C.reset}`);
    print(`           ${C.dim}${v.description}${C.reset}`);
  }

  print(`\n${C.bold}Setup Steps:${C.reset}`);
  for (const step of meta.setupSteps) {
    print(`  ${step}`);
  }

  if (meta.docsUrl) {
    print(`\n${C.bold}Documentation:${C.reset}`);
    print(`  ${C.cyan}${meta.docsUrl}${C.reset}`);
  }

  print(`\n${C.bold}Add to your .env:${C.reset}`);
  for (const v of meta.envVars) {
    if (v.required) {
      print(`  ${v.key}=your_value_here`);
    }
  }
  print('');
}

function cmdConnectorCheck(id: string) {
  const meta = findConnector(id);
  if (!meta) {
    print(`${C.red}Unknown connector: ${id}${C.reset}`);
    process.exit(1);
  }

  const checks = checkEnvVars(meta);
  const allRequired = checks.filter(x => x.required);
  const allConfigured = allRequired.every(x => x.configured);

  print(`\n${C.bold}${meta.displayName} — Config Check${C.reset}\n`);
  for (const v of meta.envVars) {
    const check = checks.find(c => c.key === v.key)!;
    const icon = check.configured ? `${C.green}✓${C.reset}` : (v.required ? `${C.red}✗${C.reset}` : `${C.dim}–${C.reset}`);
    const label = v.required ? '' : ` ${C.dim}(optional)${C.reset}`;
    print(`  ${icon} ${v.key}${label}`);
  }

  if (allConfigured) {
    print(`\n${C.green}✓ All required env vars are set. Connector is ready.${C.reset}`);
  } else {
    const missing = allRequired.filter(x => !x.configured).map(x => x.key);
    print(`\n${C.yellow}⚠ Missing: ${missing.join(', ')}${C.reset}`);
    print(`Run ${C.cyan}jowork connector guide ${id}${C.reset} for setup instructions.`);
    process.exit(1);
  }
  print('');
}

function printHelp() {
  print(`
${C.bold}jowork${C.reset} — JoWork AI Gateway CLI

${C.bold}USAGE${C.reset}
  jowork <command> [args]

${C.bold}COMMANDS${C.reset}
  ${C.cyan}status${C.reset}                        Check if Gateway is running
  ${C.cyan}version${C.reset}                       Show CLI version

  ${C.cyan}connector list${C.reset}                List all connectors and config status
  ${C.cyan}connector guide <name>${C.reset}        Print setup guide for a connector
  ${C.cyan}connector check <name>${C.reset}        Check if connector env vars are configured

${C.bold}EXAMPLES${C.reset}
  jowork status
  jowork connector list
  jowork connector guide github
  jowork connector check gitlab

${C.bold}GATEWAY URL${C.reset}
  Set ${C.dim}JOWORK_GATEWAY_URL${C.reset} env var to point to your gateway (default: http://localhost:18800)
`);
}

// ─── 主入口 ───────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const sub = args[1];
  const target = args[2];

  const gatewayUrl = process.env['JOWORK_GATEWAY_URL'] || 'http://localhost:18800';

  if (!cmd || cmd === '--help' || cmd === '-h') {
    printHelp();
    return;
  }

  switch (cmd) {
    case 'version':
    case '--version':
    case '-v':
      cmdVersion();
      break;

    case 'status':
      await cmdStatus(gatewayUrl);
      break;

    case 'connector':
      switch (sub) {
        case 'list':
          cmdConnectorList();
          break;
        case 'guide':
          if (!target) { print(`${C.red}Usage: jowork connector guide <connector-id>${C.reset}`); process.exit(1); }
          cmdConnectorGuide(target);
          break;
        case 'check':
          if (!target) { print(`${C.red}Usage: jowork connector check <connector-id>${C.reset}`); process.exit(1); }
          cmdConnectorCheck(target);
          break;
        default:
          print(`Unknown subcommand: ${sub}`);
          printHelp();
          process.exit(1);
      }
      break;

    default:
      print(`Unknown command: ${cmd}`);
      printHelp();
      process.exit(1);
  }
}

main().catch(err => {
  process.stderr.write('Error: ' + String(err) + '\n');
  process.exit(1);
});
