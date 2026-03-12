import { describe, it, expect } from 'vitest';
import { PLANS, CREDIT_COSTS, getCreditCost } from '../billing/plans';

describe('Plans', () => {
  it('defines three plans: free, pro, team', () => {
    expect(Object.keys(PLANS)).toEqual(['free', 'pro', 'team']);
  });

  it('free plan has zero price', () => {
    expect(PLANS.free.monthlyPrice).toBe(0);
    expect(PLANS.free.dailyFreeCredits).toBe(50);
    expect(PLANS.free.monthlyCredits).toBe(0);
  });

  it('pro plan costs $19/mo with 5000 credits', () => {
    expect(PLANS.pro.monthlyPrice).toBe(1900);
    expect(PLANS.pro.monthlyCredits).toBe(5000);
    expect(PLANS.pro.dailyFreeCredits).toBe(0);
  });

  it('team plan costs $29/seat with 5000 credits/seat', () => {
    expect(PLANS.team.monthlyPrice).toBe(2900);
    expect(PLANS.team.monthlyCredits).toBe(5000);
  });

  it('each plan has features', () => {
    for (const plan of Object.values(PLANS)) {
      expect(plan.features.length).toBeGreaterThan(0);
    }
  });
});

describe('Credit costs', () => {
  it('defines costs for known actions', () => {
    expect(CREDIT_COSTS['cloud-engine-message']).toBe(10);
    expect(CREDIT_COSTS['ai-notification-summary']).toBe(2);
    expect(CREDIT_COSTS['cloud-scheduled-task']).toBe(5);
  });

  it('getCreditCost returns defined cost', () => {
    expect(getCreditCost('cloud-engine-message')).toBe(10);
  });

  it('getCreditCost returns 1 for unknown actions', () => {
    expect(getCreditCost('unknown-action')).toBe(1);
  });
});
