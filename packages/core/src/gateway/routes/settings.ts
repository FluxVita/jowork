import { Router } from 'express';
import {
  setUserSetting, getUserSetting, listUserSettingKeys,
  deleteUserSetting, isAllowedKey, ALLOWED_KEYS,
} from '../../auth/settings.js';
import {
  setChannelKey, getChannelKeyMasked, listChannelKeys, deleteChannelKey,
  CHANNEL_KEYS, type ChannelKeyName,
} from '../../settings/channel-settings.js';
import { authMiddleware } from '../middleware.js';

const router = Router();

// 迁移到 channel-settings 的 key 集合
const CHANNEL_SETTING_KEYS = new Set<string>(CHANNEL_KEYS);

/** GET /api/settings — 列出当前用户所有配置键 */
router.get('/', authMiddleware, (req, res) => {
  const keys = listUserSettingKeys(req.user!.user_id);
  const channelKeys = listChannelKeys(req.user!.user_id);
  res.json({
    keys,
    allowed_keys: ALLOWED_KEYS.filter(k => !CHANNEL_SETTING_KEYS.has(k)),
    channel_keys: channelKeys,
  });
});

/** GET /api/settings/:key — 获取配置值（向后兼容，渠道密钥返回 mask） */
router.get('/:key', authMiddleware, (req, res) => {
  const key = String(req.params['key']);
  const userId = req.user!.user_id;

  // 渠道密钥 → channel-settings（mask 返回）
  if (CHANNEL_SETTING_KEYS.has(key)) {
    const result = getChannelKeyMasked(userId, key as ChannelKeyName);
    if (!result.is_set) {
      res.status(404).json({ error: 'Setting not found' });
      return;
    }
    res.json({ key, value_mask: result.value_mask, is_set: true });
    return;
  }

  if (!isAllowedKey(key)) {
    res.status(400).json({ error: `Invalid setting key. Allowed: ${ALLOWED_KEYS.join(', ')}` });
    return;
  }

  const value = getUserSetting(userId, key);
  if (value === null) {
    res.status(404).json({ error: 'Setting not found' });
    return;
  }

  // 系统级 API key 也只返回 mask
  const isJson = value.startsWith('[') || value.startsWith('{');
  const masked = !isJson && (key.includes('token') || key.includes('api_key') || key.includes('pass'))
    ? value.slice(0, 6) + '...' + value.slice(-4)
    : value;

  res.json({ key, value: masked, is_set: true });
});

/** PUT /api/settings/:key — 设置配置值 */
router.put('/:key', authMiddleware, (req, res) => {
  const key = String(req.params['key']);
  const userId = req.user!.user_id;
  const { value } = req.body as { value: string };

  if (!value || typeof value !== 'string') {
    res.status(400).json({ error: 'value is required (string)' });
    return;
  }

  // 渠道密钥 → channel-settings
  if (CHANNEL_SETTING_KEYS.has(key)) {
    setChannelKey(userId, key as ChannelKeyName, value);
    res.json({ message: `Channel key '${key}' saved` });
    return;
  }

  if (!isAllowedKey(key)) {
    res.status(400).json({ error: `Invalid setting key. Allowed: ${ALLOWED_KEYS.join(', ')}` });
    return;
  }

  setUserSetting(userId, key, value);
  res.json({ message: `Setting '${key}' saved` });
});

/** DELETE /api/settings/:key — 删除配置 */
router.delete('/:key', authMiddleware, (req, res) => {
  const key = String(req.params['key']);
  const userId = req.user!.user_id;

  if (CHANNEL_SETTING_KEYS.has(key)) {
    deleteChannelKey(userId, key as ChannelKeyName);
  } else {
    deleteUserSetting(userId, key);
  }
  res.json({ message: `Setting '${key}' deleted` });
});

export default router;
