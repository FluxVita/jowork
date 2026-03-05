import { getDb } from '../datamap/db.js';
import { getOrgSetting } from '../auth/settings.js';
import {
  getSubscriptionPlan,
  PERSONAL_MONTHLY_CREDITS,
  type PersonalPlan,
  type SubscriptionPlan,
  PLAN_UPGRADE_TARGET,
} from './entitlements.js';

// ─── 云托管检测 ───

export function isCloudHosted(): boolean {
  try {
    const val = getOrgSetting('hosting_mode');
    if (val === 'self_hosted') return false;
  } catch { /* ignore */ }
  return true; // 默认云托管
}

// ─── 计费月份 ───

function getBillingMonth(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

// 从计划名获取月度积分配额（Team 版暂时用 personal_pro 等效）
function getMonthlyCreditsForPlan(plan: SubscriptionPlan): number | null {
  if (plan in PERSONAL_MONTHLY_CREDITS) {
    return PERSONAL_MONTHLY_CREDITS[plan as PersonalPlan];
  }
  // Team 版：积分由席位等级决定，此处返回 null（不在此处限制）
  return null;
}

// ─── 确保用户当月积分记录存在 ───

function ensureUserCredits(userId: string, billingMonth: string): void {
  const db = getDb();
  const plan = getSubscriptionPlan();
  const monthlyCredits = getMonthlyCreditsForPlan(plan) ?? 0;

  db.prepare(`
    INSERT OR IGNORE INTO user_credits (user_id, billing_month, credits_total, credits_used, extra_credits)
    VALUES (?, ?, ?, 0, 0)
  `).run(userId, billingMonth, monthlyCredits);
}

// ─── 公开 API ───

export function getCreditsBalance(userId: string): {
  total: number;
  used: number;
  remaining: number;
  extra: number;
} {
  const db = getDb();
  const billingMonth = getBillingMonth();
  ensureUserCredits(userId, billingMonth);

  const row = db.prepare(`
    SELECT credits_total, credits_used, extra_credits FROM user_credits
    WHERE user_id = ? AND billing_month = ?
  `).get(userId, billingMonth) as { credits_total: number; credits_used: number; extra_credits: number } | undefined;

  if (!row) return { total: 0, used: 0, remaining: 0, extra: 0 };

  const total = row.credits_total + row.extra_credits;
  const used = row.credits_used;
  return { total, used, remaining: Math.max(total - used, 0), extra: row.extra_credits };
}

export function checkCreditSufficient(userId: string, estimatedTokens: number): boolean {
  if (!isCloudHosted()) return true;

  const balance = getCreditsBalance(userId);
  if (balance.total === 0) return true; // 0 = 无限（owner / 未设置积分配额）

  const creditsNeeded = Math.ceil(estimatedTokens / 1000);
  return balance.remaining >= creditsNeeded;
}

/** 扣减积分并记录 transaction，返回 upgrade_to 建议 */
export function deductCredits(userId: string, tokensUsed: number, modelCostId?: number): void {
  if (!isCloudHosted()) return;

  const db = getDb();
  const billingMonth = getBillingMonth();
  ensureUserCredits(userId, billingMonth);

  const credits = Math.max(Math.ceil(tokensUsed / 1000), 1);

  db.prepare(`
    UPDATE user_credits SET credits_used = credits_used + ?, updated_at = datetime('now')
    WHERE user_id = ? AND billing_month = ?
  `).run(credits, userId, billingMonth);

  db.prepare(`
    INSERT INTO credit_transactions (user_id, billing_month, credits, source, model_cost_id)
    VALUES (?, ?, ?, 'model_call', ?)
  `).run(userId, billingMonth, credits, modelCostId ?? null);
}

/** 获取当前计划的升级建议 */
export function getUpgradeTo(userId: string): string | null {
  const plan = getSubscriptionPlan();
  return PLAN_UPGRADE_TARGET[plan] ?? null;
}
