/**
 * routes/bin-server.ts
 * macmini 端 API — 提供 klaude bin 文件的元信息和下载
 * 仅 admin+ 可下载（内网使用）
 */
import { Router } from 'express';
import { existsSync, statSync, createReadStream } from 'node:fs';
import { join } from 'node:path';
import { authMiddleware, requireRole } from '../middleware.js';
import { PROJECT_ROOT } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('bin-server');
const router = Router();

// 优先读 data/bin/klaude（CI 部署路径）；
// 兜底读 KLAUDE_BIN_PATH（本地开发 / 手动配置）
const DATA_BIN = join(PROJECT_ROOT, 'data', 'bin', 'klaude');
const BIN_PATH = existsSync(DATA_BIN)
  ? DATA_BIN
  : (process.env['KLAUDE_BIN_PATH'] ?? DATA_BIN);

/** GET /api/ai-services/bin/klaude/meta — 返回修改时间（用于版本比较） */
router.get('/bin/klaude/meta', authMiddleware, (_req, res) => {
  if (!existsSync(BIN_PATH)) {
    res.status(404).json({ error: 'klaude bin 不存在' });
    return;
  }
  const st = statSync(BIN_PATH);
  res.json({
    mtime_ms: st.mtimeMs,
    mtime_iso: st.mtime.toISOString(),
    size_bytes: st.size,
  });
});

/** GET /api/ai-services/bin/klaude/download — 下载 bin 文件 */
router.get('/bin/klaude/download', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  if (!existsSync(BIN_PATH)) {
    res.status(404).json({ error: 'klaude bin 不存在' });
    return;
  }
  const st = statSync(BIN_PATH);
  log.info(`Serving klaude bin to ${req.user?.name ?? 'unknown'} (${st.size} bytes)`);

  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', 'attachment; filename="klaude"');
  res.setHeader('Content-Length', String(st.size));

  createReadStream(BIN_PATH).pipe(res);
});

export default router;
