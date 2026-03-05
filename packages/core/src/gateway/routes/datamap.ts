import { Router } from 'express';
import { searchObjects, getObject, getStats } from '../../datamap/objects.js';
import { filterByAccess, checkAccess } from '../../policy/engine.js';
import { logAudit } from '../../audit/logger.js';
import { authMiddleware } from '../middleware.js';
import type { DataSource, SourceType, Sensitivity } from '../../types.js';

const router = Router();

/** GET /api/datamap/search — 搜索数据对象（带权限裁剪） */
router.get('/search', authMiddleware, (req, res) => {
  const { q, source, source_type, sensitivity, tags, limit, offset } = req.query;

  const objects = searchObjects({
    query: q as string | undefined,
    source: source as DataSource | undefined,
    source_type: source_type as SourceType | undefined,
    sensitivity: sensitivity as Sensitivity | undefined,
    tags: tags ? (tags as string).split(',') : undefined,
    limit: limit ? parseInt(String(limit), 10) : undefined,
    offset: offset ? parseInt(String(offset), 10) : undefined,
  });

  // 权限裁剪：不可见的对象直接移除
  const filtered = filterByAccess(req.user!, objects);

  logAudit({
    actor_id: req.user!.user_id,
    actor_role: req.user!.role,
    channel: 'api',
    action: 'search',
    result: 'allowed',
    matched_rule: `returned ${filtered.length}/${objects.length}`,
  });

  res.json({ objects: filtered, total: filtered.length });
});

/** GET /api/datamap/object/:id — 获取单个对象元数据 */
router.get('/object/:id', authMiddleware, (req, res) => {
  const obj = getObject(String(req.params['id']));
  if (!obj) {
    res.status(404).json({ error: 'Object not found' });
    return;
  }

  const access = checkAccess(req.user!, obj, 'read');
  if (!access.allowed) {
    logAudit({
      actor_id: req.user!.user_id,
      actor_role: req.user!.role,
      channel: 'api',
      action: 'read',
      object_id: obj.object_id,
      object_title: obj.title,
      sensitivity: obj.sensitivity,
      result: 'denied',
      matched_rule: access.matched_rule,
    });
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  logAudit({
    actor_id: req.user!.user_id,
    actor_role: req.user!.role,
    channel: 'api',
    action: 'read',
    object_id: obj.object_id,
    object_title: obj.title,
    sensitivity: obj.sensitivity,
    result: 'allowed',
    matched_rule: access.matched_rule,
  });

  res.json({ object: obj, access_level: access.level });
});

/** GET /api/datamap/stats — 索引统计 */
router.get('/stats', authMiddleware, (req, res) => {
  const stats = getStats();
  res.json(stats);
});

export default router;
