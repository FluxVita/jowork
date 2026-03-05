import { config } from '../config.js';
import { getOrgSetting } from '../auth/settings.js';

/**
 * 获取 Gateway 公网 URL，优先级：
 * 1. 环境变量 GATEWAY_PUBLIC_URL
 * 2. scoped_settings org/default gateway_public_url（通过 Setup Wizard 写入）
 * 3. 回退 http://localhost:{port}
 */
export function getGatewayPublicUrl(): string {
  return (
    process.env['GATEWAY_PUBLIC_URL'] ??
    getOrgSetting('gateway_public_url') ??
    `http://localhost:${config.port}`
  );
}

/**
 * 获取 OAuth client_id，优先级：env var > scoped_settings > ''
 * provider 示例：'google', 'linear', 'github', 'figma', 'gitlab', 'slack', 'notion', 'microsoft', 'atlassian', 'discord'
 */
export function getOAuthClientId(provider: string): string {
  const envKey = `${provider.toUpperCase()}_CLIENT_ID`;
  return (
    process.env[envKey] ??
    getOrgSetting(`${provider}_client_id`) ??
    ''
  );
}

/**
 * 获取 OAuth client_secret，优先级：env var > scoped_settings > ''
 */
export function getOAuthClientSecret(provider: string): string {
  const envKey = `${provider.toUpperCase()}_CLIENT_SECRET`;
  return (
    process.env[envKey] ??
    getOrgSetting(`${provider}_client_secret`) ??
    ''
  );
}
