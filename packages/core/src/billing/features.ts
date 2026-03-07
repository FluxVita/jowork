import { getDb } from '../datamap/db.js';
import { getSubscriptionPlan, normalizePlanPublic, type SubscriptionPlan } from './entitlements.js';
import { isCloudHosted } from './credits.js';
import { getCurrentLicense } from './license-client.js';

// ─── Feature Keys ───

export type FeatureKey =
  | 'run_command'           // shell 命令执行（白名单）
  | 'manage_workspace'      // workspace 管理（clone/commit/push）
  | 'create_gitlab_mr'      // GitLab MR 创建
  | 'advanced_search'       // PostHog / OSS 高级数据查询
  | 'mcp_tools'             // MCP 工具接入
  | 'custom_connectors'     // 自定义 Connector
  | 'team_management'       // 成员管理（Team 版 owner）
  | 'billing_admin';        // 账单管理

// 各功能所需最低计划
const FEATURE_MIN_PLAN: Record<FeatureKey, SubscriptionPlan> = {
  run_command:        'personal_pro',
  manage_workspace:   'personal_pro',
  create_gitlab_mr:   'personal_pro',
  advanced_search:    'personal_basic',
  mcp_tools:          'personal_basic',
  custom_connectors:  'personal_pro',
  team_management:    'team_starter',
  billing_admin:      'personal_basic',
};

// 计划升级顺序（rank 越高权限越大）
const PLAN_ORDER: SubscriptionPlan[] = [
  'free',
  'personal_basic',
  'personal_pro',
  'personal_max',
  'team_starter',
  'team_pro',
  'team_business',
];

function planRank(plan: SubscriptionPlan): number {
  const idx = PLAN_ORDER.indexOf(plan);
  return idx < 0 ? 0 : idx;
}

/** 获取用户当前计划：优先 user_subscriptions（per-user），再降级到 org-level */
export function getUserPlan(userId: string): SubscriptionPlan {
  if (!isCloudHosted()) {
    // 自托管：有 License Key 则按 license 计划，否则全功能开放
    const licenseKey = process.env['JOWORK_LICENSE_KEY'];
    if (licenseKey) {
      const license = getCurrentLicense();
      return normalizePlanPublic(license.plan);
    }
    return 'personal_max'; // 无 License Key：自托管全功能（向后兼容）
  }

  try {
    const db = getDb();
    const row = db.prepare(`
      SELECT plan FROM user_subscriptions WHERE user_id = ? AND status = 'active'
    `).get(userId) as { plan: string } | undefined;
    if (row?.plan) return normalizePlanPublic(row.plan);
  } catch { /* ignore */ }

  // 降级：org-level 订阅（单机部署时读 org_settings）
  return getSubscriptionPlan();
}

// ─── 公开 API ───

export interface FeatureCheckResult {
  allowed: boolean;
  required_plan: SubscriptionPlan;
  current_plan: SubscriptionPlan;
  upgrade_to: SubscriptionPlan | null;
}

export function checkFeatureAccess(userId: string, feature: FeatureKey, userRole?: string): FeatureCheckResult {
  // owner 拥有全部权限
  if (userRole === 'owner') {
    return { allowed: true, required_plan: 'free', current_plan: 'personal_max', upgrade_to: null };
  }

  const currentPlan = getUserPlan(userId);
  const requiredPlan = FEATURE_MIN_PLAN[feature];
  const allowed = planRank(currentPlan) >= planRank(requiredPlan);

  let upgrade_to: SubscriptionPlan | null = null;
  if (!allowed) {
    const reqIdx = PLAN_ORDER.indexOf(requiredPlan);
    upgrade_to = reqIdx >= 0 ? PLAN_ORDER[reqIdx] : null;
  }

  return { allowed, required_plan: requiredPlan, current_plan: currentPlan, upgrade_to };
}

/** 简化版：只返回 boolean */
export function hasFeature(userId: string, feature: FeatureKey, userRole?: string): boolean {
  return checkFeatureAccess(userId, feature, userRole).allowed;
}

/** 功能被锁定时的标准错误文本（LLM 可读） */
export function featureGateMessage(feature: FeatureKey, currentPlan: SubscriptionPlan, requiredPlan: SubscriptionPlan): string {
  return `[Feature Gate] "${feature}" requires "${requiredPlan}" plan or higher. Current plan: "${currentPlan}". Please upgrade to continue.`;
}
