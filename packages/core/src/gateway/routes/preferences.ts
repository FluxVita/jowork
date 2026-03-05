/**
 * gateway/routes/preferences.ts
 * 用户偏好 API
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware.js';
import { getUserPreferences, updateUserPreferences, resetUserPreferences } from '../../preferences/user-preferences.js';

const router = Router();
router.use(authMiddleware);

/** GET /api/preferences — 获取当前用户偏好 */
router.get('/', (req, res) => {
  const prefs = getUserPreferences(req.user!.user_id);
  res.json({ preferences: prefs });
});

/** PUT /api/preferences — 部分更新偏好 */
router.put('/', (req, res) => {
  const user = req.user!;
  const { language, response_style, timezone, default_channel, custom } = req.body as {
    language?: string;
    response_style?: 'concise' | 'balanced' | 'detailed';
    timezone?: string;
    default_channel?: 'feishu' | 'web';
    custom?: Record<string, unknown>;
  };

  // 验证 response_style
  if (response_style && !['concise', 'balanced', 'detailed'].includes(response_style)) {
    res.status(400).json({ error: 'response_style must be one of: concise, balanced, detailed' });
    return;
  }

  const updated = updateUserPreferences(user.user_id, { language, response_style, timezone, default_channel, custom });
  res.json({ preferences: updated });
});

/** DELETE /api/preferences — 重置为默认值 */
router.delete('/', (req, res) => {
  const prefs = resetUserPreferences(req.user!.user_id);
  res.json({ preferences: prefs, reset: true });
});

export default router;
