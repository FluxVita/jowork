import { listAuthorizedConnectorIdsAllUsers } from '../connectors/oauth-store.js';
import { getOrgSetting } from '../auth/settings.js';

// ─── 计划类型 ───

// 个人版：仅积分差异，无功能门槛（云托管有效，自托管无积分限制）
export type PersonalPlan = 'free' | 'personal_basic' | 'personal_pro' | 'personal_max';

// Team 版：功能门槛差异
export type TeamTier = 'team_starter' | 'team_pro' | 'team_business';

// Team 席位等级：在某 TeamTier 下，不同席位有不同积分配额
export type SeatLevel = 'basic' | 'pro' | 'max';

export type SubscriptionPlan = PersonalPlan | TeamTier;

// 月度对话次数配额（1次 = 1条完整AI响应，含工具调用）；null = 无限制
export const MONTHLY_CONVERSATIONS: Record<PersonalPlan, number | null> = {
  free: 50,             // 50 次对话/月
  personal_basic: 500,  // 500 次对话/月
  personal_pro: 2000,   // 2000 次对话/月
  personal_max: null,   // 无限对话
};

// 向后兼容别名
export const PERSONAL_MONTHLY_CREDITS = MONTHLY_CONVERSATIONS;

// Team 席位积分（per person per month）
export const TEAM_SEAT_CREDITS: Record<TeamTier, Record<SeatLevel, number>> = {
  team_starter: { basic: 300,  pro: 800,   max: 2000  },
  team_pro:     { basic: 500,  pro: 1500,  max: 5000  },
  team_business: { basic: 1000, pro: 3000,  max: 10000 },
};

// Team 人数上限（云托管限制）
export const TEAM_MAX_USERS = 100;

// Connector 数量限制（null = 无限）
export const CONNECTOR_LIMITS: Record<SubscriptionPlan, number | null> = {
  free: 3,
  personal_basic: 5,
  personal_pro: null,
  personal_max: null,
  team_starter: 10,
  team_pro: null,
  team_business: null,
};

// 升级路径
export const PLAN_UPGRADE_TARGET: Record<SubscriptionPlan, SubscriptionPlan | null> = {
  free: 'personal_basic',
  personal_basic: 'personal_pro',
  personal_pro: 'personal_max',
  personal_max: 'team_starter',
  team_starter: 'team_pro',
  team_pro: 'team_business',
  team_business: null,
};

// ─── 计划规范化（含旧值向后兼容） ───

export function normalizePlanPublic(input: string | null | undefined): SubscriptionPlan {
  return normalizePlan(input);
}

function normalizePlan(input: string | null | undefined): SubscriptionPlan {
  const v = String(input ?? '').trim().toLowerCase();
  const valid: SubscriptionPlan[] = [
    'free', 'personal_basic', 'personal_pro', 'personal_max',
    'team_starter', 'team_pro', 'team_business',
  ];
  if (valid.includes(v as SubscriptionPlan)) return v as SubscriptionPlan;
  // 旧值向后兼容
  if (v === 'pro') return 'personal_pro';
  if (v === 'team') return 'team_starter';
  if (v === 'business') return 'team_business';
  return 'free';
}

function getConfiguredConnectorIdsFromEnv(): string[] {
  const ids = new Set<string>();
  if (process.env['GITLAB_TOKEN']) ids.add('gitlab_v1');
  if (process.env['LINEAR_API_KEY']) ids.add('linear_v1');
  if (process.env['POSTHOG_API_KEY']) ids.add('posthog_v1');
  if (process.env['GITHUB_TOKEN']) ids.add('github_v1');
  if (process.env['NOTION_TOKEN']) ids.add('notion_v1');
  if (process.env['EMAIL_FEISHU_USER'] && process.env['EMAIL_FEISHU_PASS']) ids.add('email_v1');
  if (process.env['EMAIL_QQ_USER'] && process.env['EMAIL_QQ_PASS']) ids.add('email_v1');
  if (process.env['OSS_ACCESS_KEY_ID'] && process.env['OSS_ACCESS_KEY_SECRET']) ids.add('aliyun_oss_v1');
  return [...ids];
}

export function getSubscriptionPlan(): SubscriptionPlan {
  let scopedPlan: string | null = null;
  try {
    scopedPlan = getOrgSetting('subscription_plan');
  } catch {
    scopedPlan = null;
  }
  return normalizePlan(scopedPlan ?? process.env['JOWORK_PLAN'] ?? process.env['JOWORK_TIER']);
}

function getConnectorLimit(plan: SubscriptionPlan): number | null {
  return CONNECTOR_LIMITS[plan];
}

export interface ConnectorEntitlementSummary {
  plan: SubscriptionPlan;
  connector_limit: number | null;
  connected: number;
  remaining: number | null;
  upgrade_to: SubscriptionPlan | null;
}

export interface ConnectorQuotaDecision extends ConnectorEntitlementSummary {
  allowed: boolean;
  reason?: 'already_connected' | 'limit_reached';
}

interface ConnectorQuotaOptions {
  plan?: SubscriptionPlan;
  connectedConnectorIds?: string[];
}

function getConnectedConnectorIds(): string[] {
  const oauth = listAuthorizedConnectorIdsAllUsers();
  const configured = getConfiguredConnectorIdsFromEnv();
  return [...new Set([...oauth, ...configured])];
}

export function getConnectorEntitlements(opts?: ConnectorQuotaOptions): ConnectorEntitlementSummary {
  const plan = opts?.plan ? normalizePlan(opts.plan) : getSubscriptionPlan();
  const connector_limit = getConnectorLimit(plan);
  const connected = new Set(opts?.connectedConnectorIds ?? getConnectedConnectorIds()).size;
  const remaining = connector_limit === null ? null : Math.max(connector_limit - connected, 0);
  return {
    plan,
    connector_limit,
    connected,
    remaining,
    upgrade_to: PLAN_UPGRADE_TARGET[plan],
  };
}

export function checkConnectorQuota(connectorId: string, opts?: ConnectorQuotaOptions): ConnectorQuotaDecision {
  const connectedIds = new Set(opts?.connectedConnectorIds ?? getConnectedConnectorIds());
  const normalizedPlan = opts?.plan ? normalizePlan(opts.plan) : undefined;
  const summary = getConnectorEntitlements({
    plan: normalizedPlan,
    connectedConnectorIds: [...connectedIds],
  });

  if (connectedIds.has(connectorId)) {
    return { ...summary, allowed: true, reason: 'already_connected' };
  }
  if (summary.connector_limit === null) {
    return { ...summary, allowed: true };
  }
  if (summary.connected >= summary.connector_limit) {
    return { ...summary, allowed: false, reason: 'limit_reached' };
  }
  return { ...summary, allowed: true };
}
