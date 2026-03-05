/**
 * gateway/routes/files.ts
 * 本地文件系统 API（仅 macOS 本地访问，需认证）
 */
import { Router } from 'express';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { authMiddleware } from '../middleware.js';

const router = Router();
router.use(authMiddleware);

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB 上限，超出拒绝读取

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  ext: string;
}

/** GET /api/files/home — 返回用户 HOME 目录 */
router.get('/home', (_req, res) => {
  res.json({ path: homedir() });
});

/** GET /api/files/dir?path=xxx — 列出目录内容 */
router.get('/dir', (req, res) => {
  const dirPath = req.query['path'] as string;
  if (!dirPath) { res.status(400).json({ error: 'path required' }); return; }

  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    const result: FileEntry[] = entries
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({
        name: e.name,
        path: join(dirPath, e.name),
        is_dir: e.isDirectory(),
        ext: e.isDirectory() ? '' : extname(e.name).slice(1).toLowerCase(),
      }))
      .sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      });
    res.json({ entries: result });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** GET /api/files/content?path=xxx — 读取文件文本内容 */
router.get('/content', (req, res) => {
  const filePath = req.query['path'] as string;
  if (!filePath) { res.status(400).json({ error: 'path required' }); return; }

  try {
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      res.status(413).json({ error: `文件过大（${(stat.size / 1024 / 1024).toFixed(1)} MB），超过 2MB 限制` });
      return;
    }
    const content = readFileSync(filePath, 'utf-8');
    res.json({ content });
  } catch (e: any) {
    res.status(400).json({ error: e.message });
  }
});

/** POST /api/files/quicklook { path } — 调用 macOS Quick Look */
router.post('/quicklook', (req, res) => {
  const { path } = req.body as { path?: string };
  if (!path) { res.status(400).json({ error: 'path required' }); return; }

  try {
    spawn('qlmanage', ['-p', path], { detached: true, stdio: 'ignore' }).unref();
    // qlmanage 启动后不会自动置顶，延迟 400ms 用 osascript 激活到前台
    setTimeout(() => {
      spawn('osascript', ['-e', 'tell application "qlmanage" to activate'], { stdio: 'ignore' }).unref();
    }, 400);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
