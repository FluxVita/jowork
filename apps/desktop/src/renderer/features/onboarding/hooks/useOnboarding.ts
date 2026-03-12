import { create } from 'zustand';

export interface OnboardingState {
  step: number;
  completed: boolean;
  language: string;
  skippedLogin: boolean;
  connectedDuringOnboarding: string[];
  profile: {
    role: string;
    communicationStyle: string;
    rules: string;
  };
}

interface OnboardingStore extends OnboardingState {
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  setLanguage: (lang: string) => void;
  setSkippedLogin: (skipped: boolean) => void;
  addConnector: (id: string) => void;
  setProfile: (profile: Partial<OnboardingState['profile']>) => void;
  completeOnboarding: () => void;
  loadState: () => Promise<void>;
}

const TOTAL_STEPS = 6;

export const useOnboarding = create<OnboardingStore>((set, get) => ({
  step: 1,
  completed: false,
  language: 'zh',
  skippedLogin: false,
  connectedDuringOnboarding: [],
  profile: {
    role: '',
    communicationStyle: 'concise',
    rules: '',
  },

  nextStep: () => {
    const { step } = get();
    if (step < TOTAL_STEPS) {
      set({ step: step + 1 });
      persistState(get());
    }
  },

  prevStep: () => {
    const { step } = get();
    if (step > 1) {
      set({ step: step - 1 });
      persistState(get());
    }
  },

  goToStep: (step: number) => {
    if (step >= 1 && step <= TOTAL_STEPS) {
      set({ step });
      persistState(get());
    }
  },

  setLanguage: (language: string) => {
    set({ language });
    persistState(get());
  },

  setSkippedLogin: (skippedLogin: boolean) => {
    set({ skippedLogin });
    persistState(get());
  },

  addConnector: (id: string) => {
    const current = get().connectedDuringOnboarding;
    if (!current.includes(id)) {
      set({ connectedDuringOnboarding: [...current, id] });
      persistState(get());
    }
  },

  setProfile: (profile) => {
    set({ profile: { ...get().profile, ...profile } });
    persistState(get());
  },

  completeOnboarding: () => {
    set({ completed: true });
    persistState(get());
  },

  loadState: async () => {
    try {
      const saved = await window.jowork.settings.get('onboarding');
      if (saved) {
        const parsed = typeof saved === 'string' ? JSON.parse(saved) : saved;
        set({
          step: parsed.step ?? 1,
          completed: parsed.completed ?? false,
          language: parsed.language ?? 'zh',
          skippedLogin: parsed.skippedLogin ?? false,
          connectedDuringOnboarding: parsed.connectedDuringOnboarding ?? [],
          profile: parsed.profile ?? { role: '', communicationStyle: 'concise', rules: '' },
        });
      }
    } catch {
      // First launch — start fresh
    }
  },
}));

function persistState(state: OnboardingState): void {
  const data = {
    step: state.step,
    completed: state.completed,
    language: state.language,
    skippedLogin: state.skippedLogin,
    connectedDuringOnboarding: state.connectedDuringOnboarding,
    profile: state.profile,
  };
  window.jowork.settings.set('onboarding', JSON.stringify(data)).catch(() => {});
}
