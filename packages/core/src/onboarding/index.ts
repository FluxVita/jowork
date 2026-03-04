// @jowork/core/onboarding — guided onboarding flow for Personal mode

import type { UserId } from '../types.js';
import { getDb } from '../datamap/db.js';
import { generateId, nowISO } from '../utils/index.js';

export type OnboardingStep =
  | 'welcome'
  | 'setup_agent'
  | 'add_connector'
  | 'workstyle_doc'
  | 'complete';

export interface OnboardingState {
  userId: UserId;
  currentStep: OnboardingStep;
  completedSteps: OnboardingStep[];
  startedAt: string;
  completedAt: string | null;
}

const STEP_ORDER: OnboardingStep[] = [
  'welcome',
  'setup_agent',
  'add_connector',
  'workstyle_doc',
  'complete',
];

function nextStep(current: OnboardingStep): OnboardingStep {
  const idx = STEP_ORDER.indexOf(current);
  return STEP_ORDER[Math.min(idx + 1, STEP_ORDER.length - 1)] ?? 'complete';
}

/** Get or create onboarding state for a user (stored in context_docs as a meta-doc) */
export function getOnboardingState(userId: UserId): OnboardingState {
  const db = getDb();
  const row = db.prepare(
    `SELECT content FROM context_docs WHERE scope_id = ? AND doc_type = 'onboarding_state' LIMIT 1`,
  ).get(userId) as { content: string } | undefined;

  if (row) {
    return JSON.parse(row.content) as OnboardingState;
  }

  // Create fresh state
  const state: OnboardingState = {
    userId,
    currentStep: 'welcome',
    completedSteps: [],
    startedAt: nowISO(),
    completedAt: null,
  };
  saveOnboardingState(state);
  return state;
}

export function advanceOnboarding(userId: UserId): OnboardingState {
  const state = getOnboardingState(userId);
  if (state.currentStep === 'complete') return state;

  state.completedSteps.push(state.currentStep);
  state.currentStep = nextStep(state.currentStep);
  if (state.currentStep === 'complete') {
    state.completedAt = nowISO();
  }
  saveOnboardingState(state);
  return state;
}

function saveOnboardingState(state: OnboardingState): void {
  const db = getDb();
  const existing = db.prepare(
    `SELECT id FROM context_docs WHERE scope_id = ? AND doc_type = 'onboarding_state' LIMIT 1`,
  ).get(state.userId) as { id: string } | undefined;

  const content = JSON.stringify(state);
  const now = nowISO();

  if (existing) {
    db.prepare(`UPDATE context_docs SET content = ?, updated_at = ? WHERE id = ?`).run(content, now, existing.id);
  } else {
    db.prepare(`
      INSERT INTO context_docs (id, layer, scope_id, title, content, doc_type, is_forced, created_by, updated_at)
      VALUES (?, 'personal', ?, 'onboarding_state', ?, 'onboarding_state', 0, 'system', ?)
    `).run(generateId(), state.userId, content, now);
  }
}
