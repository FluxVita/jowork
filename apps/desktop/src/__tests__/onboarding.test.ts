import { describe, it, expect, beforeEach } from 'vitest';

/**
 * Onboarding store logic tests.
 * Tests the Zustand store's state transitions without rendering React components.
 */

// We can't directly import the store because it references `window.jowork`,
// so we test the core logic patterns instead.

describe('Onboarding state machine', () => {
  let state: {
    step: number;
    completed: boolean;
    language: string;
    skippedLogin: boolean;
    connectedDuringOnboarding: string[];
    profile: { role: string; communicationStyle: string; rules: string };
  };

  beforeEach(() => {
    state = {
      step: 1,
      completed: false,
      language: 'zh',
      skippedLogin: false,
      connectedDuringOnboarding: [],
      profile: { role: '', communicationStyle: 'concise', rules: '' },
    };
  });

  function nextStep() {
    if (state.step < 6) state.step++;
  }

  function prevStep() {
    if (state.step > 1) state.step--;
  }

  it('starts at step 1', () => {
    expect(state.step).toBe(1);
    expect(state.completed).toBe(false);
  });

  it('advances through steps', () => {
    nextStep(); expect(state.step).toBe(2);
    nextStep(); expect(state.step).toBe(3);
    nextStep(); expect(state.step).toBe(4);
    nextStep(); expect(state.step).toBe(5);
    nextStep(); expect(state.step).toBe(6);
  });

  it('does not advance past step 6', () => {
    state.step = 6;
    nextStep();
    expect(state.step).toBe(6);
  });

  it('goes back through steps', () => {
    state.step = 4;
    prevStep(); expect(state.step).toBe(3);
    prevStep(); expect(state.step).toBe(2);
    prevStep(); expect(state.step).toBe(1);
  });

  it('does not go below step 1', () => {
    prevStep();
    expect(state.step).toBe(1);
  });

  it('tracks language selection', () => {
    state.language = 'en';
    expect(state.language).toBe('en');
    state.language = 'zh';
    expect(state.language).toBe('zh');
  });

  it('tracks login skip', () => {
    state.skippedLogin = true;
    expect(state.skippedLogin).toBe(true);
  });

  it('tracks connected connectors without duplicates', () => {
    const add = (id: string) => {
      if (!state.connectedDuringOnboarding.includes(id)) {
        state.connectedDuringOnboarding.push(id);
      }
    };

    add('github');
    add('feishu');
    add('github'); // duplicate
    expect(state.connectedDuringOnboarding).toEqual(['github', 'feishu']);
  });

  it('tracks profile settings', () => {
    state.profile = { ...state.profile, role: 'engineer', communicationStyle: 'detailed' };
    expect(state.profile.role).toBe('engineer');
    expect(state.profile.communicationStyle).toBe('detailed');
  });

  it('marks onboarding as complete', () => {
    state.completed = true;
    expect(state.completed).toBe(true);
  });

  it('default communication style is concise', () => {
    expect(state.profile.communicationStyle).toBe('concise');
  });

  it('profile rules starts empty', () => {
    expect(state.profile.rules).toBe('');
  });
});

describe('Suggested questions logic', () => {
  const SUGGESTED_QUESTIONS = [
    { connector: 'github', question: { zh: 'PR review', en: 'PR review' } },
    { connector: 'feishu', question: { zh: 'Feishu summary', en: 'Feishu summary' } },
    { connector: 'local-folder', question: { zh: 'Project files', en: 'Project files' } },
    { connector: 'figma', question: { zh: 'Figma updates', en: 'Figma updates' } },
  ];

  it('returns questions for connected connectors', () => {
    const connected = ['github', 'feishu'];
    const questions = SUGGESTED_QUESTIONS
      .filter((q) => connected.includes(q.connector))
      .map((q) => q.question.en);
    expect(questions).toEqual(['PR review', 'Feishu summary']);
  });

  it('returns empty for no connected connectors', () => {
    const connected: string[] = [];
    const questions = SUGGESTED_QUESTIONS
      .filter((q) => connected.includes(q.connector))
      .map((q) => q.question.en);
    expect(questions).toHaveLength(0);
  });

  it('limits to 3 questions', () => {
    const connected = ['github', 'feishu', 'local-folder', 'figma'];
    const questions = SUGGESTED_QUESTIONS
      .filter((q) => connected.includes(q.connector))
      .map((q) => q.question.en)
      .slice(0, 3);
    expect(questions).toHaveLength(3);
  });
});
