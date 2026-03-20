import type { Command } from 'commander';
import { saveCredential } from '../connectors/credential-store.js';

export function connectCommand(program: Command): void {
  program
    .command('connect')
    .description('Connect a data source')
    .argument('<source>', 'Data source: feishu, github')
    .option('--app-id <id>', 'App ID (for Feishu)')
    .option('--app-secret <secret>', 'App Secret (for Feishu)')
    .option('--token <token>', 'Access token (for GitHub)')
    .action(async (source: string, opts) => {
      switch (source) {
        case 'feishu':
          await connectFeishu(opts);
          break;
        case 'github':
          await connectGitHub(opts);
          break;
        default:
          console.error(`Unknown source: ${source}. Supported: feishu, github`);
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
