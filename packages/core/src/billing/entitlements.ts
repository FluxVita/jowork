import { listAuthorizedConnectorIdsAllUsers } from '../connectors/oauth-store.js';
import { getOrgSetting } from '../auth/settings.js';

export type SubscriptionPlan = 'free' | 'pro' | 'team' | 'business';

const CONNECTOR_LIMITS: Record<SubscriptionPlan, number | null> = {
  free: 3,
  pro: 10,
  team: null,
  business: null,
};

const PLAN_UPGRADE_TARGET: Record<SubscriptionPlan, SubscriptionPlan | null> = {
  free: 'pro',
  pro: 'team',
  team: 'business',
  business: null,
};

function normalizePlan(input: string | null | undefined): SubscriptionPlan {
  const v = String(input ?? '').trim().toLowerCase();
  if (v === 'free' || v === 'pro' || v === 'team' || v === 'business') return v;
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
  // 组织级设置优先，环境变量仅作为默认值兜底
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
  const plan = opts?.plan ?? getSubscriptionPlan();
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
  const summary = getConnectorEntitlements({
    plan: opts?.plan,
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
