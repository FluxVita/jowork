import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import { registerService, getService, listServices, updateService, updateServiceStatus } from '../../services/registry.js';
import { grantService, revokeGrant, getGrantsForService } from '../../services/grants.js';
import { resolveServicesForUser } from '../../services/resolver.js';
import { syncAllUserGroups, listSyncedGroups } from '../../services/feishu-groups.js';
import { createLogger } from '../../utils/logger.js';
import type { ServiceType, ServiceStatus, GrantType, Role } from '../../types.js';

const log = createLogger('services-route');
const router = Router();

// ─── 静态路由（必须在参数路由之前） ───

/** GET /api/services/mine — 当前用户可用的服务 */
router.get('/mine', authMiddleware, (req, res) => {
  const services = resolveServicesForUser(req.user!);
  res.json({ services });
});

/** GET /api/services/groups — 已同步的群组列表 */
router.get('/groups', authMiddleware, requireRole('owner', 'admin'), (_req, res) => {
  const groups = listSyncedGroups();
  res.json({ groups });
});

/** POST /api/services/sync-groups — 触发群组同步 */
router.post('/sync-groups', authMiddleware, requireRole('owner', 'admin'), async (_req, res) => {
  try {
    const result = await syncAllUserGroups();
    res.json({ ok: true, ...result });
  } catch (err) {
    log.error('Group sync failed', err);
    res.status(500).json({ error: `群组同步失败: ${String(err)}` });
  }
});

/** DELETE /api/services/grants/:grantId — 撤销授权 */
router.delete('/grants/:grantId', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const grantId = req.params['grantId'] as string;
  revokeGrant(grantId);
  res.json({ ok: true });
});

// ─── 根路径 ───

/** GET /api/services — 所有服务列表 */
router.get('/', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const type = req.query['type'] as ServiceType | undefined;
  const status = req.query['status'] as ServiceStatus | undefined;
  const services = listServices({ type, status });

  const result = services.map(s => {
    const grants = getGrantsForService(s.service_id);
    return { ...s, grant_count: grants.length };
  });

  res.json({ services: result });
});

/** POST /api/services — 注册新服务 */
router.post('/', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const { service_id, name, type, category, description, endpoint, config, icon, default_roles, requires_config, sort_order } = req.body as {
    service_id: string; name: string; type: ServiceType;
    category?: string; description?: string; endpoint?: string;
    config?: Record<string, unknown>; icon?: string;
    default_roles?: Role[]; requires_config?: boolean; sort_order?: number;
  };

  if (!service_id || !name || !type) {
    res.status(400).json({ error: 'service_id, name, type 为必填项' });
    return;
  }

  if (getService(service_id)) {
    res.status(409).json({ error: `服务 ${service_id} 已存在` });
    return;
  }

  const svc = registerService({ service_id, name, type, category, description, endpoint, config, icon, default_roles, requires_config, sort_order });
  log.info('Service created via API', { service_id, by: req.user!.user_id });
  res.json({ service: svc });
});

// ─── 参数路由 /:id ───

/** GET /api/services/:id — 获取单个服务详情 */
router.get('/:id', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const svc = getService(id);
  if (!svc) {
    res.status(404).json({ error: '服务不存在' });
    return;
  }
  const grants = getGrantsForService(id);
  res.json({ service: { ...svc, grant_count: grants.length } });
});

/** PUT /api/services/:id — 更新服务 */
router.put('/:id', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  if (!getService(id)) {
    res.status(404).json({ error: '服务不存在' });
    return;
  }

  updateService(id, req.body);
  const updated = getService(id);
  res.json({ service: updated });
});

/** PUT /api/services/:id/status — 更新服务状态 */
router.put('/:id/status', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const { status } = req.body as { status: ServiceStatus };

  if (!status || !['active', 'inactive', 'deprecated'].includes(status)) {
    res.status(400).json({ error: '无效的状态值' });
    return;
  }

  if (!getService(id)) {
    res.status(404).json({ error: '服务不存在' });
    return;
  }

  updateServiceStatus(id, status);
  res.json({ ok: true });
});

/** GET /api/services/:id/grants — 服务的授权列表 */
router.get('/:id/grants', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  if (!getService(id)) {
    res.status(404).json({ error: '服务不存在' });
    return;
  }

  const grants = getGrantsForService(id);
  res.json({ grants });
});

/** POST /api/services/:id/grants — 新增授权 */
router.post('/:id/grants', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const { grant_type, grant_target, expires_at } = req.body as {
    grant_type: GrantType; grant_target: string; expires_at?: string;
  };

  if (!grant_type || !grant_target) {
    res.status(400).json({ error: 'grant_type 和 grant_target 为必填项' });
    return;
  }

  if (!['role', 'user', 'group'].includes(grant_type)) {
    res.status(400).json({ error: '无效的 grant_type' });
    return;
  }

  if (!getService(id)) {
    res.status(404).json({ error: '服务不存在' });
    return;
  }

  const grant = grantService(id, grant_type, grant_target, req.user!.user_id, expires_at);
  log.info('Grant created via API', { service: id, type: grant_type, target: grant_target });
  res.json({ grant });
});

export default router;
