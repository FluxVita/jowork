/**
 * routes/ai-services.ts
 * 本地端 API — 状态查询 / bin 同步 / 启停 klaude
 * 仅 admin+ 可操作
 */
import { Router } from 'express';
import { authMiddleware, requireRole } from '../middleware.js';
import {
  getKlaudeStatus,
  checkUpdate,
  syncBin,
  startKlaude,
  stopKlaude,
} from '../../ai-services/klaude-manager.js';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { exec } from 'node:child_process';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('ai-services-route');
const router = Router();

const LOG_PATH = join(resolve(import.meta.dirname, '..', '..', '..'), 'data', 'klaude.log');

/** GET /api/ai-services/klaude/status */
router.get('/klaude/status', authMiddleware, (_req, res) => {
  res.json(getKlaudeStatus());
});

// ANSI 转义序列正则（覆盖颜色、光标、样式控制码）
const ANSI_RE = /[\x1b\x9b][\[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g;

/** GET /api/ai-services/klaude/log — 返回最近 100 行日志（已剥离 ANSI 转义） */
router.get('/klaude/log', authMiddleware, (_req, res) => {
  if (!existsSync(LOG_PATH)) { res.json({ log: '' }); return; }
  try {
    const all = readFileSync(LOG_PATH, 'utf-8').replace(ANSI_RE, '');
    const lines = all.split('\n');
    const tail = lines.slice(-100).join('\n');
    res.json({ log: tail });
  } catch {
    res.json({ log: '' });
  }
});

/** POST /api/ai-services/klaude/check-update — 检测远端是否有新版本 */
router.post('/klaude/check-update', authMiddleware, requireRole('owner', 'admin'), async (_req, res) => {
  try {
    const result = await checkUpdate();
    res.json(result);
  } catch (err) {
    log.error('Check update failed', err);
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/ai-services/klaude/sync — 从 macmini 下载最新 bin（含自动重启） */
router.post('/klaude/sync', authMiddleware, requireRole('owner', 'admin'), async (_req, res) => {
  try {
    const result = await syncBin();
    res.json(result);
  } catch (err) {
    log.error('Sync bin failed', err);
    res.status(500).json({ error: String(err) });
  }
});

/** POST /api/ai-services/klaude/start — 启动 klaude */
router.post('/klaude/start', authMiddleware, requireRole('owner', 'admin'), async (_req, res) => {
  try {
    await startKlaude();
    res.json({ ok: true, status: getKlaudeStatus() });
  } catch (err) {
    log.error('Start klaude failed', err);
    res.status(500).json({ error: String(err), status: getKlaudeStatus() });
  }
});

/** POST /api/ai-services/klaude/stop — 停止 klaude */
router.post('/klaude/stop', authMiddleware, requireRole('owner', 'admin'), (_req, res) => {
  try {
    stopKlaude();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/** GET /api/ai-services/agent-browser/status — 检测 agent-browser 是否已安装 */
router.get('/agent-browser/status', authMiddleware, (_req, res) => {
  exec('agent-browser --version 2>/dev/null', (err, stdout) => {
    if (err) {
      res.json({ installed: false, version: null });
    } else {
      const version = stdout.trim().replace(/^agent-browser\s+/, '') || null;
      res.json({ installed: true, version });
    }
  });
});

export default router;

