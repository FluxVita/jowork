// @jowork/core/gateway/routes/onboarding — Onboarding state REST API
//
// Routes:
//   GET  /api/onboarding         — get current onboarding state for authenticated user
//   POST /api/onboarding/advance — advance to the next onboarding step

import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getOnboardingState, advanceOnboarding } from '../../onboarding/index.js';

export function onboardingRouter(): Router {
  const router = Router();

  // Get onboarding state
  router.get('/api/onboarding', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      res.json(getOnboardingState(userId));
    } catch (err) { next(err); }
  });

  // Advance to next step
  router.post('/api/onboarding/advance', authenticate, (req, res, next) => {
    try {
      const userId = req.auth!.userId;
      const state  = advanceOnboarding(userId);
      res.json(state);
    } catch (err) { next(err); }
  });

  return router;
}
