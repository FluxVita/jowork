import { Router } from 'express';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, appendFileSync } from 'fs';
import { join } from 'path';
import { authMiddleware } from '../middleware.js';
import { PROJECT_ROOT } from '../../config.js';

const router = Router();
const PUBLIC_FEEDBACK_ENABLED = process.env['PUBLIC_FEEDBACK_ENABLED'] === 'true';

const FEEDBACK_DIR = join(PROJECT_ROOT, 'data');
const FEEDBACK_SUBDIR = join(FEEDBACK_DIR, 'feedback');
const AGENT_FEEDBACK_FILE = join(FEEDBACK_SUBDIR, 'agent_feedback.md');

function ensureDir() {
  if (!existsSync(FEEDBACK_DIR)) mkdirSync(FEEDBACK_DIR, { recursive: true });
}

function ensureFeedbackSubdir() {
  if (!existsSync(FEEDBACK_SUBDIR)) mkdirSync(FEEDBACK_SUBDIR, { recursive: true });
}

function formatEntry(item: { page?: string; tab?: string; url?: string; content?: string; viewport?: string; time?: string }): string {
  const ts = item.time || new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
  const pageName = item.page || 'unknown';
  return [
    `### [${pageName}] ${ts}`,
    '',
    `- **页面**: ${pageName}`,
    `- **URL**: ${item.url || '-'}`,
    `- **时间**: ${ts}`,
    item.viewport ? `- **视口**: ${item.viewport}` : null,
    '',
    '**反馈内容**:',
    '',
    (item.content || '').trim(),
    '',
    '---',
    '',
  ].filter(l => l !== null).join('\n');
}

function formatAgentBlock(
  item: { page?: string; tab?: string; url?: string; content?: string; time?: string },
  index: number,
  batchTs: string
): string {
  const ts = item.time || batchTs;
  const id = `${batchTs}-${index}`;
  const pagePath = item.url ? new URL(item.url, 'http://localhost').pathname : (item.page || 'unknown');
  const tab = item.tab || '';
  return [
    `## Feedback ${id}`,
    `- time: ${ts}`,
    `- page_path: ${pagePath}`,
    tab ? `- tab_or_section: ${tab}` : null,
    `- url: ${item.url || '-'}`,
    '',
    '### User Feedback',
    (item.content || '').trim(),
    '',
    '### Agent-Friendly Task',
    '请基于以上上下文完成产品改进，要求：',
    '1) 先复述用户在该页面遇到的真实问题或诉求。',
    '2) 给出最小可执行改动（优先前端可见行为）。',
    '3) 若涉及后端接口，说明影响范围与回归点。',
    '4) 输出验收标准（用户在同页面可复现通过）。',
    '',
    '---',
    '',
  ].filter(l => l !== null).join('\n');
}

/** POST /api/feedback — 单条反馈（兼容保留，写到 data/feedback/legacy.md） */
router.post('/', (req, res, next) => {
  if (PUBLIC_FEEDBACK_ENABLED) return next();
  return authMiddleware(req, res, next);
}, (req, res) => {
  const { page, url, content, viewport, time } = req.body as {
    page: string;
    url: string;
    content: string;
    viewport?: string;
    time?: string;
  };

  if (!content?.trim()) {
    res.status(400).json({ error: 'content is required' });
    return;
  }

  ensureDir();
  ensureFeedbackSubdir();

  const legacyFile = join(FEEDBACK_SUBDIR, 'legacy.md');
  const entry = formatEntry({ page, url, content, viewport, time });
  const existing = existsSync(legacyFile)
    ? readFileSync(legacyFile, 'utf-8')
    : '# Jowork 测试反馈（单条）\n\n---\n\n';
  writeFileSync(legacyFile, existing + entry, 'utf-8');

  res.json({ ok: true, message: '反馈已记录' });
});

const ANNOTATIONS_JSON = join(FEEDBACK_SUBDIR, 'annotations.json');

/** POST /api/feedback/batch — 批量保存到带时间戳的独立文件 */
router.post('/batch', (req, res, next) => {
  if (PUBLIC_FEEDBACK_ENABLED) return next();
  return authMiddleware(req, res, next);
}, (req, res) => {
  const { items, timestamp, annotations, markdown } = req.body as {
    items: Array<{ page?: string; tab?: string; url?: string; content?: string; viewport?: string; time?: string }>;
    timestamp?: string;
    // 精准标注数据（含 elementInfo、CSS selector 等）
    annotations?: unknown[];
    markdown?: string;
  };

  if (!Array.isArray(items) || items.length === 0) {
    res.status(400).json({ error: 'items must be a non-empty array' });
    return;
  }

  ensureFeedbackSubdir();

  const ts = timestamp || new Date().toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).replace(/[/:\s]/g, '').replace(/,/, '_');

  const filename = `${ts}.md`;
  const filepath = join(FEEDBACK_SUBDIR, filename);
  const relativePath = `data/feedback/${filename}`;

  // 若有 markdown 字段（来自精准标注系统）直接使用，否则自动生成
  const content = markdown || (
    `# Jowork 测试反馈 — ${ts}\n\n> 保存时间：${ts}，共 ${items.length} 条\n\n---\n\n` +
    items.map(item => formatEntry(item)).join('')
  );
  writeFileSync(filepath, content, 'utf-8');

  // 保存精准标注 JSON（MCP server 读取）
  if (Array.isArray(annotations) && annotations.length > 0) {
    ensureFeedbackSubdir();
    let existing: unknown[] = [];
    try { existing = JSON.parse(readFileSync(ANNOTATIONS_JSON, 'utf-8')); } catch {}
    const withMeta = (annotations as Record<string, unknown>[]).map((a) => ({
      ...a,
      _savedAt: new Date().toISOString(),
      _done: false,
    }));
    writeFileSync(ANNOTATIONS_JSON, JSON.stringify([...existing, ...withMeta], null, 2), 'utf-8');
  }

  // 同时追加到 agent_feedback.md（长期累积，Agent 可直接引用）
  const agentBlocks = items.map((item, idx) => formatAgentBlock(item, idx + 1, ts)).join('');
  if (!existsSync(AGENT_FEEDBACK_FILE)) {
    writeFileSync(AGENT_FEEDBACK_FILE, '# Jowork Agent 反馈任务库\n\n> 此文件由系统自动维护，供 AI Agent 直接引用执行产品改进任务。\n\n---\n\n', 'utf-8');
  }
  appendFileSync(AGENT_FEEDBACK_FILE, agentBlocks, 'utf-8');

  res.json({ ok: true, filename, path: relativePath, agent_feedback: 'data/feedback/agent_feedback.md' });
});

/** GET /api/feedback — 查看最新反馈文件 */
router.get('/', (req, res, next) => {
  if (PUBLIC_FEEDBACK_ENABLED) return next();
  return authMiddleware(req, res, next);
}, (_req, res) => {
  ensureFeedbackSubdir();
  let raw = '';
  try {
    const files = readdirSync(FEEDBACK_SUBDIR).filter(f => f.endsWith('.md')).sort();
    const latest = files[files.length - 1];
    if (latest) raw = readFileSync(join(FEEDBACK_SUBDIR, latest), 'utf-8');
  } catch { /* ignore */ }
  res.json({ raw });
});

export default router;
