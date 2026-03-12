export type PlanId = 'free' | 'pro' | 'team';

export interface Plan {
  id: PlanId;
  name: string;
  priceMonthly: number;
  features: string[];
}

export interface Credits {
  balance: number;
  lastTopUpAt?: Date;
}

export interface Subscription {
  planId: PlanId;
  status: 'active' | 'canceled' | 'past_due';
  currentPeriodEnd: Date;
}
