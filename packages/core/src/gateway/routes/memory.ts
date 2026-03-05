/**
 * gateway/routes/memory.ts
 * 个人记忆库 API
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware.js';
import {
  createMemory, listUserMemories, getMemoryById,
  updateMemory, deleteMemory
} from '../../memory/user-memory.js';

const router = Router();
router.use(authMiddleware);

/** GET /api/memory — 列出当前用户的记忆 */
router.get('/', (req, res) => {
  const user = req.user!;
  const { q, tags, scope, pinned_only, limit, offset } = req.query as Record<string, string>;

  const memories = listUserMemories({
    user_id: user.user_id,
    query: q,
    tags: tags ? tags.split(',').filter(Boolean) : undefined,
    scope: scope as 'personal' | 'team' | undefined,
    pinned_only: pinned_only === 'true',
    limit: limit ? parseInt(limit) : 20,
    offset: offset ? parseInt(offset) : 0,
  });

  res.json({ memories, total: memories.length });
});

/** POST /api/memory — 新建记忆 */
router.post('/', (req, res) => {
  const user = req.user!;
  const { title, content, tags, scope, pinned } = req.body as {
    title: string; content: string; tags?: string[]; scope?: 'personal' | 'team'; pinned?: boolean;
  };

  if (!title?.trim() || !content?.trim()) {
    res.status(400).json({ error: 'title and content are required' });
    return;
  }

  const memory = createMemory({ user_id: user.user_id, title, content, tags, scope, pinned });
  res.status(201).json({ memory });
});

/** GET /api/memory/:id — 获取单条记忆 */
router.get('/:id', (req, res) => {
  const user = req.user!;
  const memory_id = req.params['id'] as string;
  const memory = getMemoryById(memory_id, user.user_id);
  if (!memory) {
    res.status(404).json({ error: 'Memory not found' });
    return;
  }
  res.json({ memory });
});

/** PUT /api/memory/:id — 更新记忆 */
router.put('/:id', (req, res) => {
  const user = req.user!;
  const memory_id = req.params['id'] as string;
  const updated = updateMemory(memory_id, user.user_id, req.body);
  if (!updated) {
    res.status(404).json({ error: 'Memory not found' });
    return;
  }
  res.json({ memory: updated });
});

/** DELETE /api/memory/:id — 删除记忆 */
router.delete('/:id', (req, res) => {
  const user = req.user!;
  const memory_id = req.params['id'] as string;
  const ok = deleteMemory(memory_id, user.user_id);
  if (!ok) {
    res.status(404).json({ error: 'Memory not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
