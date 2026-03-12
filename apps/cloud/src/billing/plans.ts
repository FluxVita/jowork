export interface PlanConfig {
  id: string;
  name: string;
  monthlyPrice: number;           // USD cents
  monthlyCredits: number;
  dailyFreeCredits: number;
  features: string[];
  stripePriceId?: string;
}

export const PLANS: Record<string, PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    monthlyPrice: 0,
    monthlyCredits: 0,
    dailyFreeCredits: 50,
    features: [
      'Local engine (unlimited)',
      'Local connectors',
      'Local memory & skills',
      '50 cloud credits/day',
    ],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    monthlyPrice: 1900, // $19
    monthlyCredits: 5000,
    dailyFreeCredits: 0,
    features: [
      'Everything in Free',
      'Cloud engine',
      'Cloud scheduled tasks',
      'Remote channels (Feishu)',
      'Data sync',
      '5,000 credits/month',
      'Top-up available',
    ],
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID,
  },
  team: {
    id: 'team',
    name: 'Team',
    monthlyPrice: 2900, // $29/seat
    monthlyCredits: 5000, // per seat
    dailyFreeCredits: 0,
    features: [
      'Everything in Pro',
      'Team workspace',
      'Multi-member',
      'Shared credits pool',
      'Admin dashboard',
      'Team context docs',
    ],
    stripePriceId: process.env.STRIPE_TEAM_PRICE_ID,
  },
};

export const CREDIT_COSTS: Record<string, number> = {
  'cloud-engine-message': 10,
  'ai-notification-summary': 2,
  'cloud-scheduled-task': 5,
};

export function getCreditCost(action: string): number {
  return CREDIT_COSTS[action] ?? 1;
}
