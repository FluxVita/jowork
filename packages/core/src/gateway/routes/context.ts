/**
 * routes/context.ts — 三层上下文文档管理 API
 *
 * GET    /api/context/docs          — 列出所有文档（可按 layer/scope_id 过滤）
 * GET    /api/context/docs/:id      — 获取单个文档
 * POST   /api/context/docs          — 创建文档
 * PUT    /api/context/docs/:id      — 更新文档
 * DELETE /api/context/docs/:id      — 删除文档
 * GET    /api/context/search        — FTS 搜索文档
 */

import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import {
  listContextDocs, getContextDoc, createContextDoc,
  updateContextDoc, deleteContextDoc, searchContextDocs,
} from '../../context/docs.js';
import type { ContextLayer, DocType } from '../../context/docs.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('context-route');
const router = Router();

/** 列出文档 */
router.get('/docs', authMiddleware, (req, res) => {
  const layer = req.query['layer'] as ContextLayer | undefined;
  const scopeId = req.query['scope_id'] as string | undefined;
  res.json(listContextDocs(layer, scopeId));
});

/** 获取单个文档 */
router.get('/docs/:id', authMiddleware, (req, res) => {
  const doc = getContextDoc(req.params['id'] as string);
  if (!doc) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(doc);
});

/** 创建文档（member+ 可创建 personal，admin+ 可创建 team/company） */
router.post('/docs', authMiddleware, (req, res) => {
  const user = req.user!;
  const { layer, scope_id, title, content, doc_type, is_forced } = req.body as {
    layer: ContextLayer;
    scope_id: string;
    title: string;
    content: string;
    doc_type: DocType;
    is_forced?: boolean;
  };

  if (!layer || !scope_id || !title || !content || !doc_type) {
    res.status(400).json({ error: 'layer, scope_id, title, content, doc_type 均为必填' });
    return;
  }

  // 权限检查：非 admin 只能操作 personal 层
  if (layer !== 'personal' && !['owner', 'admin'].includes(user.role)) {
    res.status(403).json({ error: '只有 admin/owner 可以管理公司/团队层文档' });
    return;
  }

  try {
    const doc = createContextDoc({
      layer, scope_id, title, content, doc_type,
      is_forced: is_forced ?? false,
      created_by: user.user_id,
    });
    res.status(201).json(doc);
  } catch (err) {
    log.error('Create context doc failed', err);
    res.status(500).json({ error: String(err) });
  }
});

/** 更新文档 */
router.put('/docs/:id', authMiddleware, (req, res) => {
  const user = req.user!;
  const id = req.params['id'] as string;
  const existing = getContextDoc(id);

  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (existing.layer !== 'personal' && !['owner', 'admin'].includes(user.role)) {
    res.status(403).json({ error: '无权修改公司/团队层文档' });
    return;
  }

  const { title, content, doc_type, is_forced } = req.body as Partial<{
    title: string; content: string; doc_type: DocType; is_forced: boolean;
  }>;

  const updated = updateContextDoc(id, { title, content, doc_type, is_forced });
  res.json(updated);
});

/** 删除文档 */
router.delete('/docs/:id', authMiddleware, (req, res) => {
  const user = req.user!;
  const id = req.params['id'] as string;
  const existing = getContextDoc(id);

  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (existing.layer !== 'personal' && !['owner', 'admin'].includes(user.role)) {
    res.status(403).json({ error: '无权删除公司/团队层文档' });
    return;
  }

  deleteContextDoc(id);
  res.json({ ok: true });
});

/** FTS 搜索 */
router.get('/search', authMiddleware, (req, res) => {
  const q = (req.query['q'] as string) ?? '';
  if (!q) { res.json([]); return; }
  res.json(searchContextDocs(q, 10));
});

export default router;
