import type { Context } from 'hono';
import { eq, and, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { credits } from '../db/schema';
import { getCreditCost, PLANS } from './plans';

/**
 * Credit tracking and consumption.
 * Deduction order: daily_free -> monthly_limit -> wallet_balance
 */

interface CreditBalance {
  dailyFreeRemaining: number;
  monthlyRemaining: number;
  walletBalance: number;
  totalAvailable: number;
  plan: string;
}

/**
 * Ensure daily free credits are reset if past the reset time.
 */
async function ensureDailyReset(userId: string): Promise<void> {
  const db = getDb();
  const [row] = await db.select().from(credits)
    .where(and(eq(credits.userId, userId), isNull(credits.teamId)));

  if (!row) return;

  const now = new Date();
  const resetAt = row.dailyFreeResetAt;
  if (!resetAt || now >= resetAt) {
    const nextReset = new Date();
    nextReset.setUTCHours(0, 0, 0, 0);
    nextReset.setUTCDate(nextReset.getUTCDate() + 1);

    await db.update(credits)
      .set({ dailyFreeUsed: 0, dailyFreeResetAt: nextReset })
      .where(eq(credits.id, row.id));
  }
}

/**
 * Ensure a credits row exists for the user.
 */
async function ensureCreditRow(userId: string, plan: string): Promise<void> {
  const db = getDb();
  const [existing] = await db.select().from(credits)
    .where(and(eq(credits.userId, userId), isNull(credits.teamId)));

  if (existing) return;

  const planConfig = PLANS[plan] ?? PLANS.free;
  const now = new Date();
  const nextReset = new Date();
  nextReset.setUTCHours(0, 0, 0, 0);
  nextReset.setUTCDate(nextReset.getUTCDate() + 1);

  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  await db.insert(credits).values({
    id: `cr_${userId}`,
    userId,
    used: 0,
    monthlyLimit: planConfig.monthlyCredits,
    walletBalance: 0,
    dailyFreeLimit: planConfig.dailyFreeCredits,
    dailyFreeUsed: 0,
    dailyFreeResetAt: nextReset,
    periodStart,
    periodEnd,
  });
}

/**
 * GET /billing/credits — query current credit balance
 */
export async function getCredits(c: Context): Promise<Response> {
  const userId = c.get('userId');
  const plan = c.get('userPlan') || 'free';
  const db = getDb();

  await ensureCreditRow(userId, plan);
  await ensureDailyReset(userId);

  const [row] = await db.select().from(credits)
    .where(and(eq(credits.userId, userId), isNull(credits.teamId)));

  if (!row) {
    return c.json({ error: 'Credit record not found' }, 500);
  }

  const dailyFreeRemaining = Math.max(0, (row.dailyFreeLimit ?? 0) - (row.dailyFreeUsed ?? 0));
  const monthlyRemaining = Math.max(0, (row.monthlyLimit ?? 0) - (row.used ?? 0));
  const walletBalance = row.walletBalance ?? 0;

  const balance: CreditBalance = {
    dailyFreeRemaining,
    monthlyRemaining,
    walletBalance,
    totalAvailable: dailyFreeRemaining + monthlyRemaining + walletBalance,
    plan,
  };

  return c.json(balance);
}

/**
 * Consume credits for an action. Returns true if credits were available.
 * Deduction order: daily_free -> monthly_limit -> wallet_balance
 */
export async function consumeCredits(
  userId: string,
  action: string,
): Promise<{ success: boolean; cost: number; remaining: number }> {
  const cost = getCreditCost(action);
  const db = getDb();

  await ensureDailyReset(userId);

  const [row] = await db.select().from(credits)
    .where(and(eq(credits.userId, userId), isNull(credits.teamId)));

  if (!row) {
    return { success: false, cost, remaining: 0 };
  }

  let remaining = cost;

  // 1. Deduct from daily free
  const dailyFreeAvail = Math.max(0, (row.dailyFreeLimit ?? 0) - (row.dailyFreeUsed ?? 0));
  const dailyDeduct = Math.min(remaining, dailyFreeAvail);
  remaining -= dailyDeduct;

  // 2. Deduct from monthly
  const monthlyAvail = Math.max(0, (row.monthlyLimit ?? 0) - (row.used ?? 0));
  const monthlyDeduct = Math.min(remaining, monthlyAvail);
  remaining -= monthlyDeduct;

  // 3. Deduct from wallet
  const walletAvail = row.walletBalance ?? 0;
  const walletDeduct = Math.min(remaining, walletAvail);
  remaining -= walletDeduct;

  if (remaining > 0) {
    return { success: false, cost, remaining: 0 };
  }

  // Apply deductions
  await db.update(credits).set({
    dailyFreeUsed: (row.dailyFreeUsed ?? 0) + dailyDeduct,
    used: (row.used ?? 0) + monthlyDeduct,
    walletBalance: (row.walletBalance ?? 0) - walletDeduct,
  }).where(eq(credits.id, row.id));

  const totalRemaining = (dailyFreeAvail - dailyDeduct) + (monthlyAvail - monthlyDeduct) + (walletAvail - walletDeduct);
  return { success: true, cost, remaining: totalRemaining };
}

/**
 * Check if user has enough credits for an action (gate check, no deduction).
 */
export async function hasCredits(userId: string, action: string): Promise<boolean> {
  const cost = getCreditCost(action);
  const db = getDb();

  await ensureDailyReset(userId);

  const [row] = await db.select().from(credits)
    .where(and(eq(credits.userId, userId), isNull(credits.teamId)));

  if (!row) return false;

  const dailyFreeAvail = Math.max(0, (row.dailyFreeLimit ?? 0) - (row.dailyFreeUsed ?? 0));
  const monthlyAvail = Math.max(0, (row.monthlyLimit ?? 0) - (row.used ?? 0));
  const walletAvail = row.walletBalance ?? 0;

  return (dailyFreeAvail + monthlyAvail + walletAvail) >= cost;
}
