import { Router } from 'express';
import { checkAccess, canDownload } from '../../policy/engine.js';
import { getObject } from '../../datamap/objects.js';
import { authMiddleware, requireRole } from '../middleware.js';
import type { Sensitivity } from '../../types.js';

const router = Router();

/** GET /api/policy/check — 权限检查 */
router.get('/check', authMiddleware, (req, res) => {
  const { object_id, action } = req.query;

  if (!object_id || !action) {
    res.status(400).json({ error: 'object_id and action are required' });
    return;
  }

  const obj = getObject(object_id as string);
  if (!obj) {
    res.status(404).json({ error: 'Object not found' });
    return;
  }

  const result = checkAccess(req.user!, obj, action as string);
  res.json({
    allowed: result.allowed,
    level: result.level,
    matched_rule: result.matched_rule,
    can_download: canDownload(obj.sensitivity),
  });
});

/** GET /api/policy/me — 当前用户的权限策略快照 */
router.get('/me', authMiddleware, (req, res) => {
  const user = req.user!;

  // 返回该角色可访问的敏感级别
  const accessibleLevels: Sensitivity[] = [];
  if (['owner', 'admin', 'member'].includes(user.role)) {
    accessibleLevels.push('public', 'internal');
  }
  if (['owner', 'admin'].includes(user.role)) {
    accessibleLevels.push('restricted');
  }
  if (user.role === 'owner') {
    accessibleLevels.push('secret');
  }
  if (user.role === 'guest') {
    accessibleLevels.push('public');
  }

  res.json({
    user_id: user.user_id,
    role: user.role,
    accessible_levels: accessibleLevels,
    can_download_levels: accessibleLevels.filter(l => canDownload(l)),
  });
});

export default router;
