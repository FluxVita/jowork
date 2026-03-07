import { getDb } from '../datamap/db.js';
import { getOrgSetting, getScopedValue } from '../auth/settings.js';
import {
  getSubscriptionPlan,
  PERSONAL_MONTHLY_CREDITS,
  TEAM_SEAT_CREDITS,
  type PersonalPlan,
  type TeamTier,
  type SeatLevel,
  type SubscriptionPlan,
  PLAN_UPGRADE_TARGET,
} from './entitlements.js';
import { getUserPlan } from './features.js';

// ─── 云托管检测 ───

export function isCloudHosted(): boolean {
  if (process.env['JOWORK_CLOUD_MODE'] === 'true') return true;  // Mac mini 显式声明
  if (process.env['STRIPE_SECRET_KEY']) return true;              // 有收费能力
  try {
    const val = getOrgSetting('hosting_mode');
    if (val === 'cloud_hosted') return true;
    if (val === 'self_hosted') return false;
  } catch { /* ignore */ }
  return false;  // 默认：自托管（安全默认）
}

// ─── BYOK 检测 ───

/** 检查用户是否使用 BYOK（用户自带 API Key），BYOK 用户不扣对话次数 */
export function isUserBYOK(userId: string): boolean {
  if (!isCloudHosted()) return false;
  const providers = ['openrouter', 'siliconflow', 'anthropic', 'openai', 'moonshot', 'minimax'];
  for (const pid of providers) {
    try {
      const val = getScopedValue(`model_api_key_${pid}`, userId, []);
      if (val && val.source === 'user') return true;
    } catch { /* ignore */ }
  }
  return false;
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
  const plan = getUserPlan(userId);  // per-user 计划（含付费订阅）
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

export function checkCreditSufficient(userId: string, _estimatedTokens?: number): boolean {
  if (!isCloudHosted()) return true;

  const balance = getCreditsBalance(userId);
  if (balance.total === 0) return true; // 0 = 无限（owner / 未设置积分配额）

  return balance.remaining >= 1; // 还剩至少 1 次对话
}

/** 扣减 1 次对话（Phase 2：对话计次制，BYOK 用户免扣） */
export function deductOneConversation(userId: string): void {
  if (!isCloudHosted()) return;
  if (isUserBYOK(userId)) return; // BYOK 用户不扣次数

  const db = getDb();
  const billingMonth = getBillingMonth();
  ensureUserCredits(userId, billingMonth);

  db.prepare(`
    UPDATE user_credits SET credits_used = credits_used + 1, updated_at = datetime('now')
    WHERE user_id = ? AND billing_month = ?
  `).run(userId, billingMonth);

  db.prepare(`
    INSERT INTO credit_transactions (user_id, billing_month, credits, source)
    VALUES (?, ?, 1, 'conversation')
  `).run(userId, billingMonth);
}

/** 扣减积分并记录 transaction（旧接口，向后兼容） */
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

/**
 * 获取指定计划的月度积分配额
 * personal 计划直接返回 PERSONAL_MONTHLY_CREDITS；
 * team 计划按席位等级返回 TEAM_SEAT_CREDITS；null 表示无限制
 */
function getCreditsForPlan(plan: SubscriptionPlan, seatLevel?: string): number | null {
  if (plan in PERSONAL_MONTHLY_CREDITS) {
    return PERSONAL_MONTHLY_CREDITS[plan as PersonalPlan];
  }
  const level = (seatLevel ?? 'basic') as SeatLevel;
  const teamCredits = TEAM_SEAT_CREDITS[plan as TeamTier];
  return teamCredits ? (teamCredits[level] ?? teamCredits['basic']) : null;
}

/**
 * 发放积分（Stripe 订阅成功后调用，或手动充值）
 *
 * source = 'stripe_plan'：更新当月 credits_total（计划配额重置）
 * source = 其他（如 'stripe_purchase'）：累加到 extra_credits
 */
export function addCredits(userId: string, amount: number, source: string): void {
  if (!isCloudHosted()) return;

  const db = getDb();
  const billingMonth = getBillingMonth();

  if (source === 'stripe_plan') {
    // 更新当月计划配额（替换，不累加）
    db.prepare(`
      INSERT INTO user_credits (user_id, billing_month, credits_total, credits_used, extra_credits)
      VALUES (?, ?, ?, 0, 0)
      ON CONFLICT(user_id, billing_month) DO UPDATE SET
        credits_total = ?,
        updated_at = datetime('now')
    `).run(userId, billingMonth, amount, amount);
  } else {
    // 额外充值：累加到 extra_credits
    db.prepare(`
      INSERT INTO user_credits (user_id, billing_month, credits_total, credits_used, extra_credits)
      VALUES (?, ?, 0, 0, ?)
      ON CONFLICT(user_id, billing_month) DO UPDATE SET
        extra_credits = extra_credits + ?,
        updated_at = datetime('now')
    `).run(userId, billingMonth, amount, amount);
  }

  db.prepare(`
    INSERT INTO credit_transactions (user_id, billing_month, credits, source)
    VALUES (?, ?, ?, ?)
  `).run(userId, billingMonth, amount, source);
}

/**
 * 订阅计划变更时刷新当月积分配额
 * 由 Stripe webhook 调用，确保积分与新计划同步
 */
export function refreshPlanCredits(userId: string, plan: SubscriptionPlan, seatLevel?: string): void {
  const credits = getCreditsForPlan(plan, seatLevel);
  if (credits === null) return; // null = 无限制，不需要写入
  addCredits(userId, credits, 'stripe_plan');
}
