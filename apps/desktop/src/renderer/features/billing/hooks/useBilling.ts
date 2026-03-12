import { create } from 'zustand';

interface CreditInfo {
  used: number;
  monthlyLimit: number | null;
  walletBalance: number;
  dailyFreeLimit: number;
  dailyFreeUsed: number;
  remaining: number;
}

interface PlanInfo {
  id: string;
  name: string;
  price: number;
  creditsPerMonth: number | null;
  features: string[];
}

interface BillingState {
  credits: CreditInfo | null;
  plans: PlanInfo[];
  currentPlan: string;
  loading: boolean;
  loadCredits: () => Promise<void>;
  loadPlans: () => Promise<void>;
  openCheckout: (planId: string) => Promise<void>;
  openPortal: () => Promise<void>;
  buyCredits: (amount: number) => Promise<void>;
}

const DEFAULT_PLANS: PlanInfo[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    creditsPerMonth: null,
    features: [
      'Local engine unlimited',
      'Local connectors',
      'Local memories & skills',
      '50 cloud credits/day',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 19,
    creditsPerMonth: 5000,
    features: [
      'Everything in Free',
      '5,000 cloud credits/month',
      'Cloud engine access',
      'Cloud scheduled tasks',
      'Remote channels',
      'Data sync',
    ],
  },
  {
    id: 'team',
    name: 'Team',
    price: 29,
    creditsPerMonth: 5000,
    features: [
      'Everything in Pro',
      'Shared team workspace',
      'Team members & roles',
      'Shared credit pool',
      'Team admin panel',
    ],
  },
];

export const useBilling = create<BillingState>((set, get) => ({
  credits: null,
  plans: DEFAULT_PLANS,
  currentPlan: 'free',
  loading: false,

  loadCredits: async () => {
    set({ loading: true });
    try {
      const credits = await window.jowork.billing.getCredits() as CreditInfo;
      set({ credits });
    } catch {
      // Not logged in or no billing — use defaults
      set({
        credits: {
          used: 0,
          monthlyLimit: null,
          walletBalance: 0,
          dailyFreeLimit: 50,
          dailyFreeUsed: 0,
          remaining: 50,
        },
      });
    } finally {
      set({ loading: false });
    }
  },

  loadPlans: async () => {
    // Plans are static for now
    try {
      const user = await window.jowork.auth.getUser();
      if (user?.plan) {
        set({ currentPlan: user.plan });
      }
    } catch {
      // ignore
    }
  },

  openCheckout: async (planId: string) => {
    const url = await window.jowork.billing.checkout(planId);
    if (url) {
      await window.jowork.shell.openExternal(url);
    }
  },

  openPortal: async () => {
    const url = await window.jowork.billing.portal();
    if (url) {
      await window.jowork.shell.openExternal(url);
    }
  },

  buyCredits: async (amount: number) => {
    const url = await window.jowork.billing.topUp(amount);
    if (url) {
      await window.jowork.shell.openExternal(url);
    }
    // Refresh credits after a brief delay (Stripe webhook will update server-side)
    setTimeout(() => get().loadCredits(), 3000);
  },
}));
