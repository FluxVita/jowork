import { Router } from 'express';
import { authMiddleware } from '../middleware.js';
import { getOrgSetting, setScopedValue } from '../../auth/settings.js';
import { getGatewayPublicUrl } from '../../utils/gateway-url.js';
import { getDb } from '../../datamap/db.js';
import { getLocalIps, discoverServices, startAdvertising, stopAdvertising } from '../../discovery/mdns.js';
import { updateProviderApiKey } from '../../models/router.js';
import { isCloudHosted } from '../../billing/credits.js';
import { config } from '../../config.js';
import type { Role } from '../../types.js';

const router = Router();

// 需要 admin 角色才能操作（或 bootstrap 模式：无 admin 用户时开放）
function isAdmin(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

function isBootstrapMode(): boolean {
  try {
    const db = getDb();
    const row = db.prepare(
      "SELECT COUNT(*) as n FROM users WHERE is_active = 1 AND role IN ('owner', 'admin')"
    ).get() as { n: number };
    return row.n === 0;
  } catch { return true; }
}

/**
 * GET /api/system/setup-status
 * 公开接口，返回是否已完成初始化配置
 */
router.get('/setup-status', (_req, res) => {
  const done = getOrgSetting('system_setup_done') === 'true';
  const gatewayUrl = getGatewayPublicUrl();
  const mode = (getOrgSetting('jowork_mode') ?? 'solo') as 'solo' | 'host' | 'join';
  const remoteGatewayUrl = getOrgSetting('remote_gateway_url') ?? '';

  // 计算所有 OAuth 回调 URL（供前端展示）
  const oauthCallbacks = {
    feishu: `${gatewayUrl}/api/auth/oauth/callback`,
    google: `${gatewayUrl}/api/connectors/google/oauth/callback`,
    linear: `${gatewayUrl}/api/connectors/linear_v1/oauth/callback`,
    github: `${gatewayUrl}/api/connectors/github_v1/oauth/callback`,
    gitlab: `${gatewayUrl}/api/connectors/gitlab_v1/oauth/callback`,
    figma: `${gatewayUrl}/api/connectors/figma_v1/oauth/callback`,
    slack: `${gatewayUrl}/api/connectors/slack_v1/oauth/callback`,
    notion: `${gatewayUrl}/api/connectors/notion_v1/oauth/callback`,
    microsoft: `${gatewayUrl}/api/connectors/outlook_v1/oauth/callback`,
  };

  res.json({
    done,
    gateway_url: gatewayUrl,
    mode,
    remote_gateway_url: remoteGatewayUrl,
    oauth_callbacks: oauthCallbacks,
    hosting_mode: isCloudHosted() ? 'cloud' : 'self_hosted',
  });
});

/**
 * GET /api/system/local-ips
 * 返回本机所有非回环 IPv4 地址，供 Host 模式展示给团队
 */
router.get('/local-ips', (_req, res) => {
  res.json({ ips: getLocalIps() });
});

/**
 * GET /api/system/discover
 * 扫描局域网内的 Jowork 实例（3s 超时），供 Join 模式使用
 */
router.get('/discover', async (_req, res) => {
  const services = await discoverServices(3000);
  res.json({ services });
});

/**
 * POST /api/system/setup
 * 保存初始化配置（gateway_url + OAuth 凭据）
 * 要求：admin 角色 OR bootstrap 模式（无任何用户）
 */
router.post('/setup', (req, res, next) => {
  // bootstrap 模式（无任何用户）时跳过认证
  if (isBootstrapMode()) { next(); return; }
  authMiddleware(req, res, next);
}, (req, res) => {
  if (!isBootstrapMode() && (!req.user || !isAdmin(req.user.role))) {
    res.status(403).json({ error: 'Admin role required' });
    return;
  }

  const {
    gateway_url,
    mode,              // 'solo' | 'host' | 'join'
    remote_gateway_url, // Join 模式下的远端 gateway 地址
    openrouter_api_key, // 自部署用户的 OpenRouter API Key（可选）
    // 各连接器 OAuth 凭据（可选）
    feishu_app_id,
    feishu_app_secret,
    linear_client_id,
    linear_client_secret,
    github_client_id,
    github_client_secret,
    google_client_id,
    google_client_secret,
    figma_client_id,
    figma_client_secret,
    gitlab_client_id,
    gitlab_client_secret,
    slack_client_id,
    slack_client_secret,
    notion_client_id,
    notion_client_secret,
  } = req.body as Record<string, string>;

  // 写入模式
  const prevMode = getOrgSetting('jowork_mode') ?? 'solo';
  const validMode = (mode === 'solo' || mode === 'host' || mode === 'join') ? mode : 'solo';
  setScopedValue('org', 'default', 'jowork_mode', validMode);

  // mDNS 广播随模式切换
  if (validMode === 'host' && prevMode !== 'host') {
    startAdvertising(config.port);
  } else if (validMode !== 'host' && prevMode === 'host') {
    stopAdvertising();
  }

  // Join 模式：保存远端地址，gateway_url 可为空
  if (validMode === 'join') {
    if (!remote_gateway_url || typeof remote_gateway_url !== 'string') {
      res.status(400).json({ error: 'remote_gateway_url is required for join mode' });
      return;
    }
    const remoteUrl = remote_gateway_url.trim().replace(/\/$/, '');
    setScopedValue('org', 'default', 'remote_gateway_url', remoteUrl);
    setScopedValue('org', 'default', 'system_setup_done', 'true');
    res.json({ ok: true, mode: 'join', remote_gateway_url: remoteUrl });
    return;
  }

  // Solo / Host 模式：gateway_url 必填
  if (!gateway_url || typeof gateway_url !== 'string') {
    res.status(400).json({ error: 'gateway_url is required' });
    return;
  }

  const trimmed = gateway_url.trim().replace(/\/$/, '');

  // 写入 gateway_public_url
  setScopedValue('org', 'default', 'gateway_public_url', trimmed);

  // 写入可选的 OAuth 凭据
  const pairs: [string, string | undefined][] = [
    ['feishu_app_id', feishu_app_id],
    ['feishu_app_secret', feishu_app_secret],
    ['linear_client_id', linear_client_id],
    ['linear_client_secret', linear_client_secret],
    ['github_client_id', github_client_id],
    ['github_client_secret', github_client_secret],
    ['google_client_id', google_client_id],
    ['google_client_secret', google_client_secret],
    ['figma_client_id', figma_client_id],
    ['figma_client_secret', figma_client_secret],
    ['gitlab_client_id', gitlab_client_id],
    ['gitlab_client_secret', gitlab_client_secret],
    ['slack_client_id', slack_client_id],
    ['slack_client_secret', slack_client_secret],
    ['notion_client_id', notion_client_id],
    ['notion_client_secret', notion_client_secret],
  ];
  for (const [key, val] of pairs) {
    if (val && typeof val === 'string' && val.trim()) {
      setScopedValue('org', 'default', key, val.trim());
    }
  }

  // 保存自部署 OpenRouter API Key（可选）
  if (openrouter_api_key && typeof openrouter_api_key === 'string' && openrouter_api_key.trim()) {
    try {
      updateProviderApiKey('openrouter', openrouter_api_key.trim());
    } catch { /* openrouter provider 可能尚未注册，忽略 */ }
  }

  // 标记 setup 完成
  setScopedValue('org', 'default', 'system_setup_done', 'true');

  res.json({ ok: true, gateway_url: trimmed });
});

export default router;
