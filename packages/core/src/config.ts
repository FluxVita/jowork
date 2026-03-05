import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GatewayConfig } from './types.js';

// 使用 process.cwd()（服务器启动目录 = 项目根），而非 import.meta.dirname
// 确保路径在任何包位置都能正确解析
const ENV_PATH = resolve(process.cwd(), '.env');
if (existsSync(ENV_PATH)) {
  const lines = readFileSync(ENV_PATH, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function env(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env: ${key}`);
  return val;
}

export const config: GatewayConfig = {
  // 兼容 Jowork 部署变量：优先 GATEWAY_PORT，回退 JOWORK_PORT
  port: parseInt(process.env['GATEWAY_PORT'] ?? process.env['JOWORK_PORT'] ?? '18800', 10),
  host: env('GATEWAY_HOST', '0.0.0.0'),
  gateway_public_url: process.env['GATEWAY_PUBLIC_URL'],
  // 安全默认：JWT 密钥必须显式配置，避免弱默认值导致可伪造 token
  jwt_secret: env('JWT_SECRET'),
  db_path: env('DB_PATH', resolve(process.cwd(), 'data', 'datamap.db')),
  cache_dir: env('CACHE_DIR', resolve(process.cwd(), 'cache')),
  token_storage_key: env('TOKEN_STORAGE_KEY', 'jowork_token'),
  feishu: {
    app_id: env('FEISHU_APP_ID', ''),
    app_secret: env('FEISHU_APP_SECRET', ''),
    bot_open_id: process.env['FEISHU_BOT_OPEN_ID'],
    verification_token: process.env['FEISHU_VERIFICATION_TOKEN'],
    encrypt_key: process.env['FEISHU_ENCRYPT_KEY'],
  },
  gitlab: {
    url: env('GITLAB_URL', 'https://gitlab.example.com'),
    token: env('GITLAB_TOKEN', ''),
    client_id: env('GITLAB_OAUTH_CLIENT_ID', process.env['GITLAB_CLIENT_ID'] ?? ''),
    client_secret: env('GITLAB_OAUTH_CLIENT_SECRET', process.env['GITLAB_CLIENT_SECRET'] ?? ''),
    webhook_secret: process.env['GITLAB_WEBHOOK_SECRET'],
  },
  linear: {
    api_key: env('LINEAR_API_KEY', ''),
    client_id: env('LINEAR_CLIENT_ID', ''),
    client_secret: env('LINEAR_CLIENT_SECRET', ''),
  },
  figma: {
    client_id: env('FIGMA_CLIENT_ID', ''),
    client_secret: env('FIGMA_CLIENT_SECRET', ''),
  },
  github: {
    client_id: env('GITHUB_OAUTH_CLIENT_ID', ''),
    client_secret: env('GITHUB_OAUTH_CLIENT_SECRET', ''),
  },
  notion: {
    client_id: env('NOTION_CLIENT_ID', ''),
    client_secret: env('NOTION_CLIENT_SECRET', ''),
  },
  google: {
    client_id: env('GOOGLE_CLIENT_ID', ''),
    client_secret: env('GOOGLE_CLIENT_SECRET', ''),
  },
  microsoft: {
    client_id: env('MICROSOFT_CLIENT_ID', ''),
    client_secret: env('MICROSOFT_CLIENT_SECRET', ''),
    tenant_id: env('MICROSOFT_TENANT_ID', 'common'),
  },
  slack: {
    client_id: env('SLACK_CLIENT_ID', ''),
    client_secret: env('SLACK_CLIENT_SECRET', ''),
  },
  atlassian: {
    client_id: env('ATLASSIAN_CLIENT_ID', ''),
    client_secret: env('ATLASSIAN_CLIENT_SECRET', ''),
    cloud_id: env('ATLASSIAN_CLOUD_ID', ''),
  },
  discord: {
    client_id: env('DISCORD_CLIENT_ID', ''),
    client_secret: env('DISCORD_CLIENT_SECRET', ''),
  },
  posthog: {
    api_key: env('POSTHOG_API_KEY', ''),
  },
  tailscale: {
    enabled: env('TAILSCALE_ENABLED', 'true') === 'true',
  },
  email: {
    accounts: [
      {
        id: 'feishu',
        host: env('EMAIL_FEISHU_HOST', 'imap.feishu.cn'),
        port: parseInt(env('EMAIL_FEISHU_PORT', '993'), 10),
        user: env('EMAIL_FEISHU_USER', ''),
        pass: env('EMAIL_FEISHU_PASS', ''),
        tls: env('EMAIL_FEISHU_TLS', 'true') === 'true',
        // 邮箱组可见角色，逗号分隔；个人邮箱用 user:<user_id>
        acl_roles: env('EMAIL_FEISHU_ACL_ROLES', 'role:owner,role:admin,role:member').split(',').map(s => s.trim()).filter(Boolean),
      },
      {
        id: 'qq',
        host: env('EMAIL_QQ_HOST', 'imap.qq.com'),
        port: parseInt(env('EMAIL_QQ_PORT', '993'), 10),
        user: env('EMAIL_QQ_USER', ''),
        pass: env('EMAIL_QQ_PASS', ''),
        tls: env('EMAIL_QQ_TLS', 'true') === 'true',
        acl_roles: env('EMAIL_QQ_ACL_ROLES', 'role:owner,role:admin').split(',').map(s => s.trim()).filter(Boolean),
      },
    ].filter(a => a.user && a.pass), // 只保留有配置的
    sla: {
      urgent_minutes: parseInt(env('EMAIL_SLA_URGENT', '30'), 10),
      complaint_minutes: parseInt(env('EMAIL_SLA_COMPLAINT', '120'), 10),
      feedback_minutes: parseInt(env('EMAIL_SLA_FEEDBACK', '1440'), 10),
    },
  },
};
