import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import {
  listAllBindings,
  getBindingsForUser,
  createBinding,
  deleteBindingById,
  getAvailableFeishuChats,
  getAvailableEmailAccounts,
} from '../../services/group-bindings.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('group-bindings-route');
const router = Router();

/** GET /api/group-bindings — 所有绑定（owner） */
router.get('/', authMiddleware, requireRole('owner'), (_req, res) => {
  const bindings = listAllBindings();
  res.json({ bindings });
});

/** GET /api/group-bindings/mine — 当前用户可见的绑定 */
router.get('/mine', authMiddleware, (req, res) => {
  const bindings = getBindingsForUser(req.user!.user_id);
  res.json({ bindings });
});

/** GET /api/group-bindings/sources — 可선数据源列表（owner） */
router.get('/sources', authMiddleware, requireRole('owner'), async (_req, res) => {
  const [feishu_chats, email_accounts] = await Promise.all([
    getAvailableFeishuChats(),
    Promise.resolve(getAvailableEmailAccounts()),
  ]);
  res.json({ feishu_chats, email_accounts });
});

/** POST /api/group-bindings — 创建绑定（owner） */
router.post('/', authMiddleware, requireRole('owner'), (req, res) => {
  const { group_id, group_name, source_type, source_instance_id, source_instance_name } = req.body;
  if (!group_id || !source_type || !source_instance_id) {
    res.status(400).json({ error: 'group_id, source_type, source_instance_id 为必填' });
    return;
  }
  if (source_type !== 'feishu_chat' && source_type !== 'email_account') {
    res.status(400).json({ error: 'source_type 仅支持 feishu_chat 或 email_account' });
    return;
  }
  try {
    const binding = createBinding(
      group_id,
      group_name ?? null,
      source_type,
      source_instance_id,
      source_instance_name ?? null,
      req.user!.user_id,
    );
    res.json({ ok: true, binding });
  } catch (err) {
    log.error('Create binding failed', err);
    res.status(500).json({ error: String(err) });
  }
});

/** DELETE /api/group-bindings/:id — 删除绑定（owner） */
router.delete('/:id', authMiddleware, requireRole('owner'), (req, res) => {
  const id = parseInt(req.params['id'] as string);
  if (isNaN(id)) {
    res.status(400).json({ error: '无效的绑定 ID' });
    return;
  }
  const ok = deleteBindingById(id);
  res.json({ ok });
});

export default router;
