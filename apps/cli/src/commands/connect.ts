import type { Command } from 'commander';
import { saveCredential } from '../connectors/credential-store.js';
import { runSync } from './sync.js';

/** Sources that support sync (have a sync module). */
const SYNCABLE_SOURCES = new Set(['feishu', 'github', 'gitlab', 'linear', 'posthog', 'firebase']);

/** Auto-sync after a successful connect. */
async function autoSync(source: string): Promise<void> {
  if (!SYNCABLE_SOURCES.has(source)) return;
  console.log(`\nRunning initial sync for ${source}...`);
  try {
    await runSync([source]);
  } catch {
    console.log(`\u26a0 Initial sync failed. You can retry with: jowork sync --source ${source}`);
  }
}

export function connectCommand(program: Command): void {
  program
    .command('connect')
    .description('Connect a data source')
    .argument('<source>', 'Data source: feishu, github, gitlab, linear, posthog, slack, telegram, firebase')
    .option('--app-id <id>', 'App ID (for Feishu)')
    .option('--app-secret <secret>', 'App Secret (for Feishu)')
    .option('--token <token>', 'Access token (for GitHub/GitLab)')
    .option('--api-url <url>', 'API base URL (for GitLab self-hosted)')
    .option('--api-key <key>', 'API key (for Linear/PostHog/Firebase)')
    .option('--host <host>', 'API host (for PostHog self-hosted)')
    .option('--project-id <id>', 'Project ID (for PostHog/Firebase)')
    .option('--webhook-url <url>', 'Webhook URL (for Slack)')
    .option('--bot-token <token>', 'Bot token (for Telegram)')
    .option('--chat-id <id>', 'Chat ID (for Telegram)')
    .option('--property-id <id>', 'Property ID (for Firebase GA4)')
    .action(async (source: string, opts) => {
      switch (source) {
        case 'feishu':
          await connectFeishu(opts);
          break;
        case 'github':
          await connectGitHub(opts);
          break;
        case 'gitlab':
          await connectGitLab(opts);
          break;
        case 'linear':
          await connectLinear(opts);
          break;
        case 'posthog':
          await connectPostHog(opts);
          break;
        case 'slack':
          await connectSlack(opts);
          break;
        case 'telegram':
          await connectTelegram(opts);
          break;
        case 'firebase':
          await connectFirebase(opts);
          break;
        default:
          console.error(`Unknown source: ${source}. Supported: feishu, github, gitlab, linear, posthog, slack, telegram, firebase`);
          process.exit(1);
      }
    });
}

async function connectFeishu(opts: { appId?: string; appSecret?: string }): Promise<void> {
  let appId = opts.appId;
  let appSecret = opts.appSecret;

  // Try loading from env if not provided
  if (!appId) appId = process.env['FEISHU_APP_ID'];
  if (!appSecret) appSecret = process.env['FEISHU_APP_SECRET'];

  if (!appId || !appSecret) {
    // Interactive prompt
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'input', name: 'appId', message: 'Feishu App ID:', when: !appId },
      { type: 'password', name: 'appSecret', message: 'Feishu App Secret:', when: !appSecret },
    ]);
    appId = appId ?? answers.appId;
    appSecret = appSecret ?? answers.appSecret;
  }

  if (!appId || !appSecret) {
    console.error('Error: App ID and App Secret are required.');
    process.exit(1);
  }

  // Verify credentials by getting tenant access token
  console.log('Verifying Feishu credentials...');
  try {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await res.json() as { code: number; msg: string; tenant_access_token?: string };
    if (data.code !== 0) {
      console.error(`Feishu auth failed: ${data.msg}`);
      console.error('  Hint: App ID/Secret invalid. Check at https://open.feishu.cn/app');
      process.exit(1);
    }
    console.log('\u2713 Feishu credentials verified');
  } catch (err) {
    console.error(`Network error: ${err}`);
    process.exit(1);
  }

  saveCredential('feishu', {
    type: 'feishu',
    data: { appId, appSecret },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log('\u2713 Feishu connected.');
  await autoSync('feishu');
}

async function connectGitHub(opts: { token?: string }): Promise<void> {
  let token = opts.token;
  if (!token) token = process.env['GITHUB_PERSONAL_ACCESS_TOKEN'];

  if (!token) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'password', name: 'token', message: 'GitHub Personal Access Token:' },
    ]);
    token = answers.token;
  }

  if (!token) {
    console.error('Error: GitHub token is required.');
    process.exit(1);
  }

  // Verify credentials
  console.log('Verifying GitHub credentials...');
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'jowork' },
    });
    if (!res.ok) {
      console.error(`GitHub auth failed: HTTP ${res.status}`);
      console.error('  Hint: Token invalid or expired. Create a new one at https://github.com/settings/tokens');
      process.exit(1);
    }
    const user = await res.json() as { login: string };
    console.log(`\u2713 GitHub credentials verified (user: ${user.login})`);
  } catch (err) {
    console.error(`Network error: ${err}`);
    process.exit(1);
  }

  saveCredential('github', {
    type: 'github',
    data: { token },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log('\u2713 GitHub connected.');
  await autoSync('github');
}

async function connectGitLab(opts: { token?: string; apiUrl?: string }): Promise<void> {
  let token = opts.token;
  let apiUrl = opts.apiUrl;
  if (!token) token = process.env['GITLAB_TOKEN'];
  if (!apiUrl) apiUrl = process.env['GITLAB_API_URL'];

  if (!token) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'password', name: 'token', message: 'GitLab Personal Access Token:' },
      { type: 'input', name: 'apiUrl', message: 'GitLab API URL (leave blank for gitlab.com):', default: '' },
    ]);
    token = answers.token;
    if (answers.apiUrl) apiUrl = answers.apiUrl;
  }

  if (!token) {
    console.error('Error: GitLab token is required.');
    process.exit(1);
  }

  const baseUrl = apiUrl || 'https://gitlab.com';

  // Verify credentials
  console.log('Verifying GitLab credentials...');
  try {
    const res = await fetch(`${baseUrl}/api/v4/user`, {
      headers: { 'PRIVATE-TOKEN': token },
    });
    if (!res.ok) {
      console.error(`GitLab auth failed: HTTP ${res.status}`);
      console.error('  Hint: Token invalid. Check at https://gitlab.com/-/profile/personal_access_tokens');
      process.exit(1);
    }
    const user = await res.json() as { username: string };
    console.log(`\u2713 GitLab credentials verified (user: ${user.username})`);
  } catch (err) {
    console.error(`Network error: ${err}`);
    process.exit(1);
  }

  const credData: Record<string, string> = { token };
  if (apiUrl) credData.apiUrl = apiUrl;

  saveCredential('gitlab', {
    type: 'gitlab',
    data: credData,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log('\u2713 GitLab connected.');
  await autoSync('gitlab');
}

async function connectLinear(opts: { apiKey?: string }): Promise<void> {
  let apiKey = opts.apiKey;
  if (!apiKey) apiKey = process.env['LINEAR_API_KEY'];

  if (!apiKey) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: 'Linear API Key:' },
    ]);
    apiKey = answers.apiKey;
  }

  if (!apiKey) {
    console.error('Error: Linear API key is required.');
    process.exit(1);
  }

  // Verify credentials
  console.log('Verifying Linear credentials...');
  try {
    const res = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey,
      },
      body: JSON.stringify({ query: '{ viewer { name email } }' }),
    });
    if (!res.ok) {
      console.error(`Linear auth failed: HTTP ${res.status}`);
      console.error('  Hint: API key invalid. Get one at https://linear.app/settings/api');
      process.exit(1);
    }
    const data = await res.json() as { data?: { viewer?: { name: string; email: string } }; errors?: Array<{ message: string }> };
    if (data.errors?.length) {
      console.error(`Linear auth failed: ${data.errors[0].message}`);
      console.error('  Hint: API key invalid. Get one at https://linear.app/settings/api');
      process.exit(1);
    }
    console.log(`\u2713 Linear credentials verified (user: ${data.data?.viewer?.name})`);
  } catch (err) {
    console.error(`Network error: ${err}`);
    process.exit(1);
  }

  saveCredential('linear', {
    type: 'linear',
    data: { apiKey },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log('\u2713 Linear connected.');
  await autoSync('linear');
}

async function connectPostHog(opts: { apiKey?: string; host?: string; projectId?: string }): Promise<void> {
  let apiKey = opts.apiKey;
  const host = opts.host ?? 'https://app.posthog.com';
  const projectId = opts.projectId ?? '1';

  if (!apiKey) apiKey = process.env['POSTHOG_API_KEY'];

  if (!apiKey) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'password', name: 'apiKey', message: 'PostHog Personal API Key:' },
    ]);
    apiKey = answers.apiKey;
  }

  if (!apiKey) {
    console.error('Error: API key is required.');
    process.exit(1);
  }

  // Verify credentials
  console.log('Verifying PostHog credentials...');
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      console.error(`PostHog auth failed: HTTP ${res.status}`);
      console.error('  Hint: API key invalid. Get one at https://app.posthog.com/project/settings');
      process.exit(1);
    }
    console.log('\u2713 PostHog credentials verified');
  } catch (err) {
    console.error(`PostHog verification failed: ${err}`);
    process.exit(1);
  }

  saveCredential('posthog', {
    type: 'posthog',
    data: { apiKey, host, projectId },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log('\u2713 PostHog connected.');
  await autoSync('posthog');
}

async function connectSlack(opts: Record<string, string | undefined>): Promise<void> {
  let webhookUrl = opts.webhookUrl;
  if (!webhookUrl) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'input', name: 'webhookUrl', message: 'Slack Incoming Webhook URL:' },
    ]);
    webhookUrl = answers.webhookUrl;
  }
  if (!webhookUrl) {
    console.error('Error: Webhook URL required.');
    process.exit(1);
  }

  saveCredential('slack', {
    type: 'slack',
    data: { webhookUrl },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  console.log('\u2713 Slack connected.');
}

async function connectTelegram(opts: Record<string, string | undefined>): Promise<void> {
  let botToken = opts.botToken;
  let chatId = opts.chatId;
  if (!botToken || !chatId) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'password', name: 'botToken', message: 'Telegram Bot Token:', when: !botToken },
      { type: 'input', name: 'chatId', message: 'Default Chat ID:', when: !chatId },
    ]);
    botToken = botToken ?? answers.botToken;
    chatId = chatId ?? answers.chatId;
  }
  if (!botToken) {
    console.error('Error: Bot token required.');
    process.exit(1);
  }

  saveCredential('telegram', {
    type: 'telegram',
    data: { botToken, chatId: chatId ?? '' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  console.log('\u2713 Telegram connected.');
}

async function connectFirebase(opts: Record<string, string | undefined>): Promise<void> {
  let projectId = opts.projectId;
  let apiKey = opts.apiKey;
  let propertyId = opts.propertyId;

  if (!projectId || !apiKey) {
    const { default: inquirer } = await import('inquirer');
    const answers = await inquirer.prompt([
      { type: 'input', name: 'projectId', message: 'Firebase Project ID:', when: !projectId },
      { type: 'password', name: 'apiKey', message: 'API Key (GA4 Data API):', when: !apiKey },
      { type: 'input', name: 'propertyId', message: 'GA4 Property ID (optional, defaults to project ID):', when: !propertyId },
    ]);
    projectId = projectId ?? answers.projectId;
    apiKey = apiKey ?? answers.apiKey;
    propertyId = propertyId ?? answers.propertyId;
  }

  if (!projectId) {
    console.error('Error: Project ID required.');
    process.exit(1);
  }
  if (!apiKey) {
    console.error('Error: API key required.');
    process.exit(1);
  }

  const propId = propertyId || projectId;

  // Verify credentials by hitting GA4 Data API metadata endpoint
  console.log('Verifying Firebase/GA4 credentials...');
  try {
    const res = await fetch(
      `https://analyticsdata.googleapis.com/v1beta/properties/${propId}/metadata?key=${apiKey}`,
    );
    if (!res.ok) {
      console.error(`Firebase/GA4 auth failed: HTTP ${res.status}`);
      console.error('  Hint: Check your API key and Property ID at https://console.cloud.google.com');
      process.exit(1);
    }
    console.log('\u2713 Firebase/GA4 credentials verified');
  } catch (err) {
    console.error(`Network error: ${err}`);
    process.exit(1);
  }

  const credData: Record<string, string> = { projectId, apiKey };
  if (propertyId) credData.propertyId = propertyId;

  saveCredential('firebase', {
    type: 'firebase',
    data: credData,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  console.log('\u2713 Firebase connected.');
  await autoSync('firebase');
}
