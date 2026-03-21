import type { Command } from 'commander';
import { saveCredential } from '../connectors/credential-store.js';

export function connectCommand(program: Command): void {
  program
    .command('connect')
    .description('Connect a data source')
    .argument('<source>', 'Data source: feishu, github, gitlab, linear')
    .option('--app-id <id>', 'App ID (for Feishu)')
    .option('--app-secret <secret>', 'App Secret (for Feishu)')
    .option('--token <token>', 'Access token (for GitHub/GitLab)')
    .option('--api-url <url>', 'API base URL (for GitLab self-hosted)')
    .option('--api-key <key>', 'API key (for Linear)')
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
        default:
          console.error(`Unknown source: ${source}. Supported: feishu, github, gitlab, linear`);
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

  console.log('\u2713 Feishu connected. Run `jowork sync` to start syncing data.');
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

  saveCredential('github', {
    type: 'github',
    data: { token },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  console.log('\u2713 GitHub connected.');
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

  console.log('\u2713 GitLab connected. Run `jowork sync` to start syncing data.');
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
      process.exit(1);
    }
    const data = await res.json() as { data?: { viewer?: { name: string; email: string } }; errors?: Array<{ message: string }> };
    if (data.errors?.length) {
      console.error(`Linear auth failed: ${data.errors[0].message}`);
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

  console.log('\u2713 Linear connected. Run `jowork sync` to start syncing data.');
}
