/**
 * License Server API（Phase 4）
 * Mac mini 侧（JOWORK_CLOUD_MODE=true）验证自托管用户的 License Key。
 * 自托管 Gateway 启动时向此端点发起验证，缓存结果到本地 SQLite。
 */

import { Router, type Request, type Response } from 'express';
import { isCloudHosted } from '../../billing/credits.js';
import { getDb } from '../../datamap/db.js';
import { createLogger } from '../../utils/logger.js';
import type { FeatureKey } from '../../billing/features.js';

const log = createLogger('license-server');
const router = Router();

// 计划 → 功能权限映射
const PLAN_FEATURES: Record<string, FeatureKey[]> = {
  free: [],
  personal_basic: ['advanced_search', 'mcp_tools', 'billing_admin'],
  personal_pro: [
    'advanced_search', 'mcp_tools', 'billing_admin',
    'run_command', 'manage_workspace', 'create_gitlab_mr', 'custom_connectors',
  ],
  personal_max: [
    'advanced_search', 'mcp_tools', 'billing_admin',
    'run_command', 'manage_workspace', 'create_gitlab_mr', 'custom_connectors',
  ],
  team_starter: [
    'advanced_search', 'mcp_tools', 'billing_admin',
    'run_command', 'manage_workspace', 'create_gitlab_mr', 'custom_connectors',
    'team_management',
  ],
  team_pro: [
    'advanced_search', 'mcp_tools', 'billing_admin',
    'run_command', 'manage_workspace', 'create_gitlab_mr', 'custom_connectors',
    'team_management',
  ],
  team_business: [
    'advanced_search', 'mcp_tools', 'billing_admin',
    'run_command', 'manage_workspace', 'create_gitlab_mr', 'custom_connectors',
    'team_management',
  ],
};

/**
 * POST /api/license/verify
 * 自托管 Gateway 向 Mac mini 发送的 License 验证请求。
 * 仅在云托管实例（jowork.work）上响应。
 */
router.post('/verify', (req: Request, res: Response) => {
  if (!isCloudHosted()) {
    res.status(503).json({ error: 'License server only available on cloud instance' });
    return;
  }

  const { license_key, gateway_version, fingerprint } = req.body as {
    license_key?: string;
    gateway_version?: string;
    fingerprint?: string;
  };

  if (!license_key) {
    res.status(400).json({ error: 'license_key required' });
    return;
  }

  log.info(`License verify: key=${license_key.slice(0, 8)}... ver=${gateway_version ?? 'unknown'} fp=${(fingerprint ?? '').slice(0, 8)}`);

  try {
    const db = getDb();

    // 查 user_subscriptions 的 license_key 字段
    const row = db.prepare(`
      SELECT us.plan, us.seat_level, us.status, us.current_period_end, u.email
      FROM user_subscriptions us
      JOIN users u ON u.user_id = us.user_id
      WHERE us.license_key = ? AND us.status = 'active'
    `).get(license_key) as {
      plan: string;
      seat_level: string;
      status: string;
      current_period_end: string | null;
      email: string;
    } | undefined;

    if (!row) {
      res.json({
        valid: false,
        plan: 'free',
        features: [] as FeatureKey[],
        expires_at: null,
        message_quota: null,
        error: 'License key not found or inactive',
      });
      return;
    }

    const features = PLAN_FEATURES[row.plan] ?? [];

    res.json({
      valid: true,
      plan: row.plan,
      features,
      expires_at: row.current_period_end,
      message_quota: null,  // 自托管无次数限制
    });
  } catch (err) {
    log.error('License verify error', err);
    res.status(500).json({ error: String(err) });
  }
});

export default router;
