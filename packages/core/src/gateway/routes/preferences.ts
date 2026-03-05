/**
 * gateway/routes/preferences.ts
 * 用户偏好 API
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware.js';
import {
  getUserPreferences,
  updateUserPreferences,
  resetUserPreferences,
  storeApiKey,
  hasApiKey,
  getApiKeyMasked,
} from '../../preferences/user-preferences.js';

const router = Router();
router.use(authMiddleware);

/** GET /api/preferences — 获取当前用户偏好 */
router.get('/', (req, res) => {
  const user = req.user!;
  const prefs = getUserPreferences(user.user_id);
  res.json({
    preferences: prefs,
    api_key_set: hasApiKey(user.user_id),
    api_key_masked: getApiKeyMasked(user.user_id),
  });
});

/** PUT /api/preferences — 部分更新偏好 */
router.put('/', (req, res) => {
  const user = req.user!;
  const {
    language,
    response_style,
    timezone,
    default_channel,
    use_case,
    api_mode,
    deploy_mode,
    api_key,
    custom,
  } = req.body as {
    language?: string;
    response_style?: 'concise' | 'balanced' | 'detailed';
    timezone?: string;
    default_channel?: 'feishu' | 'web';
    use_case?: 'personal' | 'team';
    api_mode?: 'own_key' | 'subscription';
    deploy_mode?: 'desktop' | 'server';
    api_key?: string;
    custom?: Record<string, unknown>;
  };

  // 验证 response_style
  if (response_style && !['concise', 'balanced', 'detailed'].includes(response_style)) {
    res.status(400).json({ error: 'response_style must be one of: concise, balanced, detailed' });
    return;
  }

  // 验证枚举值
  if (use_case && !['personal', 'team'].includes(use_case)) {
    res.status(400).json({ error: 'use_case must be personal or team' });
    return;
  }
  if (api_mode && !['own_key', 'subscription'].includes(api_mode)) {
    res.status(400).json({ error: 'api_mode must be own_key or subscription' });
    return;
  }
  if (deploy_mode && !['desktop', 'server'].includes(deploy_mode)) {
    res.status(400).json({ error: 'deploy_mode must be desktop or server' });
    return;
  }

  // API Key 单独加密存储
  if (api_key && api_key.trim()) {
    storeApiKey(user.user_id, api_key.trim());
  }

  const updated = updateUserPreferences(user.user_id, {
    language,
    response_style,
    timezone,
    default_channel,
    use_case,
    api_mode,
    deploy_mode,
    custom,
  });

  res.json({
    preferences: updated,
    api_key_set: hasApiKey(user.user_id),
    api_key_masked: getApiKeyMasked(user.user_id),
  });
});

/** DELETE /api/preferences — 重置为默认值 */
router.delete('/', (req, res) => {
  const prefs = resetUserPreferences(req.user!.user_id);
  res.json({ preferences: prefs, reset: true });
});

export default router;
