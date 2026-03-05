import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import { getDb } from '../../datamap/db.js';
import { genId } from '../../utils/id.js';

const router = Router();

/** GET /api/groups — 列出所有群组 */
router.get('/', authMiddleware, requireRole('admin'), (_req, res) => {
  const db = getDb();
  const groups = db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM user_groups ug WHERE ug.group_id = g.group_id) as member_count
    FROM groups g ORDER BY g.created_at DESC
  `).all();
  res.json({ groups });
});

/** POST /api/groups — 创建群组 */
router.post('/', authMiddleware, requireRole('admin'), (req, res) => {
  const { name, feishu_dept_id, parent_id } = req.body as {
    name?: string;
    feishu_dept_id?: string;
    parent_id?: string;
  };
  if (!name?.trim()) {
    res.status(400).json({ error: 'name 不能为空' });
    return;
  }
  const db = getDb();
  const groupId = genId('grp');
  db.prepare(`
    INSERT INTO groups (group_id, name, feishu_dept_id, parent_id, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(groupId, name.trim(), feishu_dept_id ?? null, parent_id ?? null, req.user!.user_id);
  res.json({ group_id: groupId, name: name.trim() });
});

/** PUT /api/groups/:id — 更新群组 */
router.put('/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const groupId = req.params['id'] as string;
  const { name, feishu_dept_id, parent_id } = req.body as {
    name?: string;
    feishu_dept_id?: string;
    parent_id?: string;
  };
  const db = getDb();
  const existing = db.prepare('SELECT * FROM groups WHERE group_id = ?').get(groupId);
  if (!existing) { res.status(404).json({ error: '群组不存在' }); return; }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name.trim()); }
  if (feishu_dept_id !== undefined) { updates.push('feishu_dept_id = ?'); params.push(feishu_dept_id || null); }
  if (parent_id !== undefined) { updates.push('parent_id = ?'); params.push(parent_id || null); }

  if (updates.length === 0) { res.json({ message: 'no changes' }); return; }
  params.push(groupId);
  db.prepare(`UPDATE groups SET ${updates.join(', ')} WHERE group_id = ?`).run(...params);
  res.json({ message: 'updated' });
});

/** DELETE /api/groups/:id — 删除群组 */
router.delete('/:id', authMiddleware, requireRole('admin'), (req, res) => {
  const groupId = req.params['id'] as string;
  const db = getDb();
  db.prepare('DELETE FROM user_groups WHERE group_id = ?').run(groupId);
  db.prepare('DELETE FROM groups WHERE group_id = ?').run(groupId);
  res.json({ message: 'deleted' });
});

/** GET /api/groups/:id/members — 成员列表 */
router.get('/:id/members', authMiddleware, requireRole('admin'), (req, res) => {
  const groupId = req.params['id'] as string;
  const db = getDb();
  const members = db.prepare(`
    SELECT u.user_id, u.name, u.email, u.role, u.avatar_url, ug.synced_at
    FROM user_groups ug JOIN users u ON u.user_id = ug.user_id
    WHERE ug.group_id = ? AND u.is_active = 1
    ORDER BY u.name
  `).all(groupId);
  res.json({ members });
});

/** POST /api/groups/:id/members — 添加成员 */
router.post('/:id/members', authMiddleware, requireRole('admin'), (req, res) => {
  const groupId = req.params['id'] as string;
  const { user_id } = req.body as { user_id?: string };
  if (!user_id) { res.status(400).json({ error: 'user_id 不能为空' }); return; }

  const db = getDb();
  const group = db.prepare('SELECT group_id, name FROM groups WHERE group_id = ?').get(groupId) as { group_id: string; name: string } | undefined;
  if (!group) { res.status(404).json({ error: '群组不存在' }); return; }

  db.prepare(`
    INSERT OR REPLACE INTO user_groups (user_id, group_id, group_name, synced_at)
    VALUES (?, ?, ?, datetime('now'))
  `).run(user_id, groupId, group.name);
  res.json({ message: 'added' });
});

/** DELETE /api/groups/:id/members/:userId — 移除成员 */
router.delete('/:id/members/:userId', authMiddleware, requireRole('admin'), (req, res) => {
  const groupId = req.params['id'] as string;
  const userId = req.params['userId'] as string;
  const db = getDb();
  db.prepare('DELETE FROM user_groups WHERE group_id = ? AND user_id = ?').run(groupId, userId);
  res.json({ message: 'removed' });
});

export default router;
