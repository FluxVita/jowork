import type { Context } from 'hono';
import { getCreditCost } from './plans';

/**
 * Credit tracking and consumption.
 * Deduction order: daily_free → monthly_limit → wallet_balance
 */

interface CreditBalance {
  dailyFreeRemaining: number;
  monthlyRemaining: number;
  walletBalance: number;
  totalAvailable: number;
  plan: string;
}

/**
 * GET /billing/credits — query current credit balance
 */
export async function getCredits(c: Context): Promise<Response> {
  const userId = c.get('userId');

  // TODO: query credits table from DB
  const balance: CreditBalance = {
    dailyFreeRemaining: 50,
    monthlyRemaining: 0,
    walletBalance: 0,
    totalAvailable: 50,
    plan: c.get('userPlan') || 'free',
  };

  return c.json(balance);
}

/**
 * Consume credits for an action. Returns true if credits were available.
 */
export function consumeCredits(
  _userId: string,
  action: string,
): { success: boolean; cost: number; remaining: number } {
  const cost = getCreditCost(action);

  // TODO: actual DB deduction with transactional safety
  // Deduction order: daily_free → monthly_limit → wallet_balance
  return {
    success: true,
    cost,
    remaining: 0,
  };
}

/**
 * Check if user has enough credits for an action (gate check, no deduction).
 */
export function hasCredits(_userId: string, action: string): boolean {
  const _cost = getCreditCost(action);
  // TODO: check DB
  return true;
}
