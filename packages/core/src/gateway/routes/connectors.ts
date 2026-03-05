import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { listConnectors, getConnector, healthCheckAll } from '../../connectors/registry.js';
import { supportsOAuth, type OAuthConnector } from '../../connectors/protocol.js';
import { deleteOAuthCredentials, isOAuthAuthorized, listAuthorizedConnectors } from '../../connectors/oauth-store.js';
import { authMiddleware, requireRole } from '../middleware.js';
import { checkAccess, canDownload } from '../../policy/engine.js';
import { logAudit } from '../../audit/logger.js';
import { getObjectByUri, getObject } from '../../datamap/objects.js';
import { createLogger } from '../../utils/logger.js';
import { config } from '../../config.js';
import { checkConnectorQuota, getConnectorEntitlements } from '../../billing/entitlements.js';
import { setScopedValue } from '../../auth/settings.js';
import type { Role } from '../../types.js';

const log = createLogger('connectors-route');

// 支持全文本地存储的 connector 集合
const FULLTEXT_CONNECTORS = new Set(['feishu_v1', 'gitlab_v1', 'linear_v1', 'email_v1']);
const PER_USER_OAUTH_CONNECTORS = new Set(['outlook_v1', 'google']);
const OAUTH_CONNECTOR_ALIAS: Record<string, string> = {
  gmail_v1: 'google',
  google_drive_v1: 'google',
  google_docs_v1: 'google',
  google_calendar_v1: 'google',
};

const router = Router();

function isAdminRole(role: Role): boolean {
  return role === 'owner' || role === 'admin';
}

function oauthCredentialUserId(connectorId: string, userId: string): string {
  return PER_USER_OAUTH_CONNECTORS.has(connectorId) ? userId : 'system';
}

function canManageOAuth(role: Role, connectorId: string): boolean {
  if (PER_USER_OAUTH_CONNECTORS.has(connectorId)) return true;
  return isAdminRole(role);
}

function resolveOAuthConnectorId(connectorId: string): string {
  return OAUTH_CONNECTOR_ALIAS[connectorId] || connectorId;
}

/** GET /api/connectors — 列出所有连接器 */
router.get('/', authMiddleware, (req, res) => {
  const connectors = listConnectors().map((c) => {
    const oauthConnectorId = resolveOAuthConnectorId(c.id);
    const connector = getConnector(oauthConnectorId) as unknown as OAuthConnector | undefined;
    const oauth_supported = !!connector && supportsOAuth(connector);
    const credentialUserId = oauthCredentialUserId(oauthConnectorId, req.user!.user_id);
    return {
      ...c,
      oauth_supported,
      oauth_authorized: oauth_supported ? isOAuthAuthorized(oauthConnectorId, credentialUserId) : false,
      oauth_scope: PER_USER_OAUTH_CONNECTORS.has(oauthConnectorId) ? 'user' : 'system',
      oauth_connector_id: oauth_supported ? oauthConnectorId : null,
    };
  });
  res.json({ connectors });
});

/** GET /api/connectors/health — 所有连接器健康检查 */
router.get('/health', authMiddleware, requireRole('admin', 'owner'), async (_req, res) => {
  const results = await healthCheckAll();
  res.json({ health: results });
});

/** GET /api/connectors/entitlements — 当前套餐连接器能力 */
router.get('/entitlements', authMiddleware, requireRole('admin', 'owner'), (_req, res) => {
  res.json(getConnectorEntitlements());
});

/** PUT /api/connectors/entitlements — 设置当前组织套餐（owner/admin） */
router.put('/entitlements', authMiddleware, requireRole('admin', 'owner'), (req, res) => {
  const plan = String((req.body as { plan?: string })?.plan || '').trim().toLowerCase();
  if (!['free', 'pro', 'team', 'business'].includes(plan)) {
    res.status(400).json({ error: 'Invalid plan, expected one of: free, pro, team, business' });
    return;
  }

  setScopedValue('org', 'default', 'subscription_plan', plan);
  const ent = getConnectorEntitlements({ plan: plan as 'free' | 'pro' | 'team' | 'business' });
  res.json({
    ok: true,
    message: `Subscription plan set to ${plan}`,
    ...ent,
  });
});

/** GET /api/connectors/:id/discover/stream — SSE 流式 discover（实时进度） */
router.get('/:id/discover/stream', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const id = String(req.params['id']);
  const quota = checkConnectorQuota(id);
  if (!quota.allowed) {
    res.status(402).json({
      error: `Connector limit reached for plan "${quota.plan}"`,
      code: 'CONNECTOR_LIMIT_REACHED',
      ...quota,
    });
    return;
  }
  const connector = getConnector(id);
  if (!connector) {
    res.status(404).json({ error: 'Connector not found' });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (event: string, data: Record<string, unknown>) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const supportsFulltext = FULLTEXT_CONNECTORS.has(id);

  logAudit({
    actor_id: req.user!.user_id,
    actor_role: req.user!.role,
    channel: 'api',
    action: 'admin',
    result: 'allowed',
    matched_rule: `discover:${connector.id}`,
  });

  send('start', {
    connector_id: id,
    supports_fulltext: supportsFulltext,
    message: supportsFulltext
      ? '开始同步并保存全文到本地...'
      : '开始同步（仅索引，此数据源不支持全文本地存储）',
  });

  try {
    const objects = await connector.discover();
    send('done', {
      connector_id: id,
      discovered: objects.length,
      supports_fulltext: supportsFulltext,
      message: supportsFulltext
        ? `同步完成：共发现 ${objects.length} 条数据，全文已保存到本地`
        : `同步完成：共发现 ${objects.length} 条索引数据（不含全文）`,
    });
  } catch (err) {
    log.error(`discover stream failed: ${id}`, err);
    send('error', { connector_id: id, message: String(err) });
  }

  res.end();
});

/** POST /api/connectors/:id/discover — 触发数据发现 */
router.post('/:id/discover', authMiddleware, requireRole('admin', 'owner'), async (req, res) => {
  const id = String(req.params['id']);
  const quota = checkConnectorQuota(id);
  if (!quota.allowed) {
    res.status(402).json({
      error: `Connector limit reached for plan "${quota.plan}"`,
      code: 'CONNECTOR_LIMIT_REACHED',
      ...quota,
    });
    return;
  }

  const connector = getConnector(id);
  if (!connector) {
    res.status(404).json({ error: 'Connector not found' });
    return;
  }

  logAudit({
    actor_id: req.user!.user_id,
    actor_role: req.user!.role,
    channel: 'api',
    action: 'admin',
    result: 'allowed',
    matched_rule: `discover:${connector.id}`,
  });

  try {
    const objects = await connector.discover();
    res.json({ connector_id: connector.id, discovered: objects.length });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/connectors/:id/fetch — 按需拉取内容 */
router.post('/:id/fetch', authMiddleware, async (req, res) => {
  const connector = getConnector(String(req.params['id']));
  if (!connector) {
    res.status(404).json({ error: 'Connector not found' });
    return;
  }

  const { uri } = req.body as { uri: string };
  if (!uri) {
    res.status(400).json({ error: 'uri is required' });
    return;
  }

  // 检查权限：必须先命中数据地图对象，避免未注册 URI 直取绕过 ACL
  const obj = getObjectByUri(uri);
  if (!obj) {
    res.status(403).json({ error: 'Object must be registered in data map before fetch' });
    return;
  }

  if (obj.source !== connector.source) {
    res.status(400).json({ error: `URI source mismatch: expected ${connector.source}, got ${obj.source}` });
    return;
  }

  const access = checkAccess(req.user!, obj, 'read');
  if (!access.allowed) {
    logAudit({
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      channel: 'api',
      action: 'read',
      object_id: obj.object_id,
      object_title: obj.title,
      sensitivity: obj.sensitivity,
      result: 'denied',
      matched_rule: access.matched_rule,
    });
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  try {
    const result = await connector.fetch(uri, {
      user_id: req.user!.user_id,
      role: req.user!.role,
    });

    logAudit({
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      channel: 'api',
      action: 'read',
      object_id: obj?.object_id,
      object_title: obj?.title,
      sensitivity: obj?.sensitivity,
      result: 'allowed',
      matched_rule: `fetch:${connector.id}`,
      response_sources: [connector.source],
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/connectors/:id/download — 下载对象内容到本地（仅 public/internal） */
router.post('/:id/download', authMiddleware, async (req, res) => {
  const connector = getConnector(String(req.params['id']));
  if (!connector) {
    res.status(404).json({ error: 'Connector not found' });
    return;
  }

  const { uri } = req.body as { uri: string };
  if (!uri) {
    res.status(400).json({ error: 'uri is required' });
    return;
  }

  // 查找对象
  const obj = getObjectByUri(uri);
  if (!obj) {
    res.status(404).json({ error: 'Object not found in data map' });
    return;
  }

  // 权限检查
  const access = checkAccess(req.user!, obj, 'read');
  if (!access.allowed) {
    logAudit({
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      channel: 'api',
      action: 'download',
      object_id: obj.object_id,
      object_title: obj.title,
      sensitivity: obj.sensitivity,
      result: 'denied',
      matched_rule: access.matched_rule,
    });
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  // 敏感级别检查：restricted/secret 禁止本地下沉
  if (!canDownload(obj.sensitivity)) {
    logAudit({
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      channel: 'api',
      action: 'download',
      object_id: obj.object_id,
      object_title: obj.title,
      sensitivity: obj.sensitivity,
      result: 'denied',
      matched_rule: `sensitivity:${obj.sensitivity}:no_download`,
    });
    res.status(403).json({
      error: `Data with sensitivity "${obj.sensitivity}" cannot be downloaded locally. Only public/internal data is allowed.`,
    });
    return;
  }

  try {
    const result = await connector.fetch(uri, {
      user_id: req.user!.user_id,
      role: req.user!.role,
    });

    logAudit({
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      channel: 'api',
      action: 'download',
      object_id: obj.object_id,
      object_title: obj.title,
      sensitivity: obj.sensitivity,
      result: 'allowed',
      matched_rule: `download:${connector.id}:${obj.sensitivity}`,
      response_sources: [connector.source],
    });

    res.json({
      ...result,
      object: {
        object_id: obj.object_id,
        title: obj.title,
        source: obj.source,
        sensitivity: obj.sensitivity,
      },
      download_allowed: true,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════════════════════
// OAuth 路由
// ═══════════════════════════════════════════════════════

// OAuth state 防 CSRF（内存，10 分钟 TTL）
const oauthStates = new Map<string, { connectorId: string; userId: string; expiresAt: number }>();

function issueOAuthState(connectorId: string, userId: string): string {
  const state = randomBytes(16).toString('hex');
  oauthStates.set(state, { connectorId, userId, expiresAt: Date.now() + 10 * 60 * 1000 });
  return state;
}

function consumeOAuthState(state: string): { connectorId: string; userId: string } | null {
  const entry = oauthStates.get(state);
  if (!entry || Date.now() > entry.expiresAt) { oauthStates.delete(state); return null; }
  oauthStates.delete(state);
  return { connectorId: entry.connectorId, userId: entry.userId };
}

/** GET /api/connectors/:id/oauth/url — 获取 OAuth 授权 URL */
router.get('/:id/oauth/url', authMiddleware, (req, res) => {
  const requestedId = String(req.params['id']);
  const id = resolveOAuthConnectorId(requestedId);
  if (!canManageOAuth(req.user!.role, id)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  const quota = checkConnectorQuota(requestedId);
  if (!quota.allowed) {
    res.status(402).json({
      error: `Connector limit reached for plan "${quota.plan}"`,
      code: 'CONNECTOR_LIMIT_REACHED',
      ...quota,
    });
    return;
  }

  const raw = getConnector(id);
  const connector = raw as unknown as OAuthConnector | undefined;

  if (!connector || !supportsOAuth(connector)) {
    res.status(404).json({ error: 'Connector not found or does not support OAuth' });
    return;
  }

  const baseUrl = config.gateway_public_url || `http://localhost:${config.port}`;
  const redirectUri = `${baseUrl}/api/connectors/${id}/oauth/callback`;
  const state = issueOAuthState(id, req.user!.user_id);
  const url = connector.buildOAuthUrl(state, redirectUri);

  res.json({ url, redirect_uri: redirectUri });
});

/** GET /api/connectors/:id/oauth/callback — OAuth 回调，换 token */
router.get('/:id/oauth/callback', async (req, res) => {
  const id = String(req.params['id']);
  const { code, state, error } = req.query as Record<string, string>;

  if (error) {
    res.status(400).send(`<script>window.opener?.postMessage({type:'oauth_error',error:'${error}'},location.origin);window.close()</script>`);
    return;
  }

  const stateData = consumeOAuthState(state);
  if (!stateData || stateData.connectorId !== id) {
    res.status(400).send('<script>window.opener?.postMessage({type:"oauth_error",error:"invalid_state"},location.origin);window.close()</script>');
    return;
  }

  const raw = getConnector(id);
  const connector = raw as unknown as OAuthConnector | undefined;
  if (!connector || !supportsOAuth(connector)) {
    res.status(404).send('Connector not found');
    return;
  }

  try {
    const quota = checkConnectorQuota(id);
    if (!quota.allowed) {
      res.status(402).send(`<script>window.opener?.postMessage({type:'oauth_error',error:'CONNECTOR_LIMIT_REACHED'},location.origin);window.close()</script>`);
      return;
    }

    const baseUrl = config.gateway_public_url || `http://localhost:${config.port}`;
    const redirectUri = `${baseUrl}/api/connectors/${id}/oauth/callback`;
    await connector.exchangeToken(code, redirectUri, oauthCredentialUserId(id, stateData.userId));

    res.send(`<script>window.opener?.postMessage({type:'oauth_success',connector_id:'${id}'},location.origin);window.close()</script>`);
  } catch (err) {
    log.error(`OAuth exchange failed: ${id}`, err);
    const msg = encodeURIComponent(String(err));
    res.status(500).send(`<script>window.opener?.postMessage({type:'oauth_error',error:'${msg}'},location.origin);window.close()</script>`);
  }
});

/** DELETE /api/connectors/:id/oauth — 断开 OAuth 授权 */
router.delete('/:id/oauth', authMiddleware, (req, res) => {
  const id = resolveOAuthConnectorId(String(req.params['id']));
  if (!canManageOAuth(req.user!.role, id)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return;
  }
  deleteOAuthCredentials(id, oauthCredentialUserId(id, req.user!.user_id));
  res.json({ ok: true });
});

/** GET /api/connectors/oauth/status — 列出所有已授权的 connector */
router.get('/oauth/status', authMiddleware, requireRole('admin', 'owner'), (_req, res) => {
  const list = listAuthorizedConnectors();
  const withStatus = list.map(c => ({
    ...c,
    authorized: isOAuthAuthorized(c.connector_id),
  }));
  res.json({
    connectors: withStatus,
    entitlements: getConnectorEntitlements(),
  });
});

export default router;
