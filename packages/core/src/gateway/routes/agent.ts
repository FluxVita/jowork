import { Router } from 'express';
import { createReadStream, statSync } from 'node:fs';
import { authMiddleware, requireRole } from '../middleware.js';
import { agentChat } from '../../agent/controller.js';
import { listSessions, searchSessions, getSession, getMessages, archiveSession, deleteSession, deleteAllUserSessions } from '../../agent/session.js';
import { getDb } from '../../datamap/db.js';
import { getWorkstyle, saveWorkstyle } from '../../agent/workstyle.js';
import { listMcpServers, addMcpServer, removeMcpServer, getAllMcpToolDefs, executeMcpTool, shutdownAllBridges, setMcpServerActive, updateMcpServer, getMcpServerStatus, getOrCreateBridge, getActiveMcpServers } from '../../agent/mcp-bridge.js';
import { listSkills, installSkill, uninstallSkill, setSkillActive, getAllSkillToolDefs, getAllSkillPrompts } from '../../skills/manager.js';
import { executeSkillTool } from '../../skills/executor.js';
import { listEngines, getDefaultEngine, setDefaultEngine } from '../../agent/engines/dispatcher.js';
import { assembleContextPrompt } from '../../context/docs.js';
import { isCrossUserConversationQuery, CROSS_USER_QUERY_DENIED_MESSAGE } from '../../agent/security.js';
import type { SkillManifest } from '../../skills/types.js';
import type { EngineType } from '../../agent/types.js';
import { createAgentTask, getAgentTask, listAgentTasks, runAgentTaskBackground } from '../../agent/tasks.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('agent-route');
const router = Router();

// ─── 活跃的 AbortController 映射（sessionId → AbortController） ───
const activeControllers = new Map<string, AbortController>();

// ═══════════════════════════════════════
// Agent Chat
// ═══════════════════════════════════════

/** POST /api/agent/chat — SSE streaming 对话 */
router.post('/chat', authMiddleware, async (req, res) => {
  const { message, session_id, engine, images } = req.body as {
    message?: string;
    session_id?: string;
    engine?: EngineType;
    images?: import('../../agent/types.js').ImageAttachment[];
  };

  if (!message?.trim() && (!images || images.length === 0)) {
    res.status(400).json({ error: 'message or images is required' });
    return;
  }

  if (isCrossUserConversationQuery(message)) {
    res.status(403).json({
      error: CROSS_USER_QUERY_DENIED_MESSAGE,
      code: 'CROSS_USER_QUERY_DENIED',
    });
    return;
  }

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const user = req.user!;

  // AbortController 用于中断
  const abortController = new AbortController();
  let resolvedSessionId = session_id ?? '';

  // 若是已有 session（恢复对话），立即注册 AbortController，
  // 避免等待 session_created 事件（该事件只在新建 session 时触发）
  if (resolvedSessionId) {
    activeControllers.set(resolvedSessionId, abortController);
  }

  // 客户端断开时中断（必须监听 res，不能监听 req）
  // Node.js 18+ 中 req 的 'close' 在请求 body 被消费后即触发，
  // 远早于 SSE 连接断开，会导致 AbortController 立即中断。
  res.on('close', () => {
    abortController.abort();
    if (resolvedSessionId) {
      activeControllers.delete(resolvedSessionId);
    }
  });

  try {
    // 收集 MCP + Skills 工具
    let extraTools = [...getAllSkillToolDefs()];
    let mcpTools;
    try {
      mcpTools = await getAllMcpToolDefs();
      extraTools = [...extraTools, ...mcpTools];
    } catch (err) {
      log.warn('Failed to load MCP tools', String(err));
    }

    const extraPrompts = getAllSkillPrompts();

    // 三层上下文：组装 context_docs 提示片段
    const contextPrompt = assembleContextPrompt({
      userId: user.user_id,
      query: (message ?? '').trim(),
    });
    if (contextPrompt) extraPrompts.push(contextPrompt);

    // 外部工具执行器
    const externalToolExecutor = async (name: string, input: Record<string, unknown>): Promise<string> => {
      if (name.startsWith('mcp_')) {
        return executeMcpTool(name, input);
      }
      if (name.startsWith('skill_')) {
        return executeSkillTool(name, input);
      }
      throw new Error(`Unknown external tool: ${name}`);
    };

    const stream = agentChat({
      userId: user.user_id,
      role: user.role,
      sessionId: session_id,
      message: (message ?? '').trim(),
      images: images && images.length > 0 ? images : undefined,
      engine,
      signal: abortController.signal,
      extraTools: extraTools.length > 0 ? extraTools : undefined,
      extraPrompts: extraPrompts.length > 0 ? extraPrompts : undefined,
      externalToolExecutor: extraTools.length > 0 ? externalToolExecutor : undefined,
    });

    for await (const event of stream) {
      // 新建 session 时：更新 resolvedSessionId 并注册 AbortController
      if (event.event === 'session_created' && event.data.session_id) {
        resolvedSessionId = event.data.session_id;
        activeControllers.set(resolvedSessionId, abortController);
      }

      res.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);

      // stopped 事件后立即结束
      if (event.event === 'stopped') break;
    }
  } catch (err) {
    log.error('Agent chat error', err);
    res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
  } finally {
    if (resolvedSessionId) {
      activeControllers.delete(resolvedSessionId);
    }
  }

  res.write('event: done\ndata: {}\n\n');
  res.end();
});

/** POST /api/agent/stop — 中断对话 */
router.post('/stop', authMiddleware, (req, res) => {
  const { session_id } = req.body as { session_id?: string };

  if (!session_id) {
    res.status(400).json({ error: 'session_id is required' });
    return;
  }

  const controller = activeControllers.get(session_id);
  if (controller) {
    controller.abort();
    activeControllers.delete(session_id);
    res.json({ ok: true, stopped: true });
  } else {
    res.json({ ok: true, stopped: false, message: 'No active stream for this session' });
  }
});

// ═══════════════════════════════════════
// Engines
// ═══════════════════════════════════════

/** GET /api/agent/engines — 引擎列表 + 用户默认引擎 */
router.get('/engines', authMiddleware, (req, res) => {
  const engines = listEngines();
  const defaultEngine = getDefaultEngine(req.user!.user_id);
  res.json({ engines, default: defaultEngine });
});

/** PUT /api/agent/engine — 设置用户默认引擎 */
router.put('/engine', authMiddleware, (req, res) => {
  const { engine } = req.body as { engine?: EngineType };

  if (!engine || !['builtin', 'claude_agent'].includes(engine)) {
    res.status(400).json({ error: 'engine must be "builtin" or "claude_agent"' });
    return;
  }

  setDefaultEngine(req.user!.user_id, engine);
  res.json({ ok: true, engine });
});

// ═══════════════════════════════════════
// Sessions
// ═══════════════════════════════════════

/** GET /api/agent/sessions — 会话列表 */
router.get('/sessions', authMiddleware, (req, res) => {
  const limit = parseInt(req.query['limit'] as string) || 50;
  const sessions = listSessions(req.user!.user_id, limit);
  res.json({ sessions });
});

/** GET /api/agent/sessions/search — 搜索会话 */
router.get('/sessions/search', authMiddleware, (req, res) => {
  const q = (req.query['q'] as string)?.trim();
  if (!q) {
    res.status(400).json({ error: 'q is required' });
    return;
  }
  const limit = parseInt(req.query['limit'] as string) || 20;
  const sessions = searchSessions(req.user!.user_id, q, limit);
  res.json({ sessions });
});

/** GET /api/agent/sessions/:id — 会话详情 + 消息历史 */
router.get('/sessions/:id', authMiddleware, (req, res) => {
  const session = getSession(req.params['id'] as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.user_id !== req.user!.user_id) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  const messages = getMessages(session.session_id);
  res.json({ session, messages });
});

/** DELETE /api/agent/sessions — 清空当前用户所有会话 */
router.delete('/sessions', authMiddleware, (req, res) => {
  deleteAllUserSessions(req.user!.user_id);
  res.json({ ok: true });
});

/** DELETE /api/agent/sessions/:id — 删除单个会话 */
router.delete('/sessions/:id', authMiddleware, (req, res) => {
  const session = getSession(req.params['id'] as string);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }
  if (session.user_id !== req.user!.user_id) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  deleteSession(session.session_id);
  res.json({ ok: true });
});

// ═══════════════════════════════════════
// Message Feedback
// ═══════════════════════════════════════

/** POST /api/agent/feedback — 提交消息反馈（👍/👎） */
router.post('/feedback', authMiddleware, (req, res) => {
  const { message_id, session_id, rating, comment } = req.body as {
    message_id?: number;
    session_id?: string;
    rating?: number;
    comment?: string;
  };

  if (!message_id || !session_id || (rating !== 1 && rating !== -1)) {
    res.status(400).json({ error: 'message_id, session_id, and rating (1 or -1) are required' });
    return;
  }

  // 验证 session 归属
  const session = getSession(session_id);
  if (!session || session.user_id !== req.user!.user_id) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO message_feedback (message_id, session_id, user_id, rating, comment)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(message_id, user_id) DO UPDATE SET rating=excluded.rating, comment=excluded.comment
    `).run(message_id, session_id, req.user!.user_id, rating, comment ?? null);

    res.json({ ok: true });
  } catch (err) {
    log.error('Failed to save feedback', err);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// ═══════════════════════════════════════
// MCP Servers
// ═══════════════════════════════════════

/** GET /api/agent/mcp-servers — 列出 MCP 服务器 */
router.get('/mcp-servers', authMiddleware, requireRole('owner', 'admin'), (_req, res) => {
  const servers = listMcpServers();
  res.json({ servers });
});

/** POST /api/agent/mcp-servers — 添加 MCP 服务器 */
router.post('/mcp-servers', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const { name, command, args, env } = req.body as {
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  };

  if (!name?.trim() || !command?.trim()) {
    res.status(400).json({ error: 'name and command are required' });
    return;
  }

  const server = addMcpServer({ name, command, args, env });
  res.status(201).json({ server });
});

/** DELETE /api/agent/mcp-servers/:id — 删除 MCP 服务器 */
router.delete('/mcp-servers/:id', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const ok = removeMcpServer(id);
  if (!ok) {
    res.status(404).json({ error: 'MCP server not found' });
    return;
  }
  res.json({ ok: true });
});

/** PUT /api/agent/mcp-servers/:id — 更新 MCP 服务器配置 */
router.put('/mcp-servers/:id', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const { name, command, args, env } = req.body as {
    name?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
  };

  const ok = updateMcpServer(id, { name, command, args, env });
  if (!ok) {
    res.status(404).json({ error: 'MCP server not found or no changes' });
    return;
  }
  res.json({ ok: true });
});

/** PUT /api/agent/mcp-servers/:id/status — 启用/禁用 MCP 服务器 */
router.put('/mcp-servers/:id/status', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const { active } = req.body as { active?: boolean };

  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'active (boolean) is required' });
    return;
  }

  const ok = setMcpServerActive(id, active);
  if (!ok) {
    res.status(404).json({ error: 'MCP server not found' });
    return;
  }
  res.json({ ok: true });
});

/** GET /api/agent/mcp-servers/:id/status — 获取运行状态 */
router.get('/mcp-servers/:id/status', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const status = getMcpServerStatus(id);
  res.json(status);
});

/** POST /api/agent/mcp-servers/:id/restart — 重启 MCP 服务器 */
router.post('/mcp-servers/:id/restart', authMiddleware, requireRole('owner', 'admin'), async (req, res) => {
  const id = req.params['id'] as string;
  const servers = getActiveMcpServers();
  const serverConfig = servers.find(s => s.id === id);
  if (!serverConfig) {
    res.status(404).json({ error: 'MCP server not found or not active' });
    return;
  }

  try {
    const status = getMcpServerStatus(id);
    if (status.running) {
      setMcpServerActive(id, false);
      setMcpServerActive(id, true);
    }
    await getOrCreateBridge(serverConfig);
    res.json({ ok: true, running: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════
// Skills
// ═══════════════════════════════════════

/** GET /api/agent/skills — 列出 Skills */
router.get('/skills', authMiddleware, (_req, res) => {
  const skills = listSkills();
  res.json({ skills: skills.map(s => ({ ...s, manifest_json: undefined, manifest: s.manifest })) });
});

/** POST /api/agent/skills — 安装 Skill */
router.post('/skills', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const manifest = req.body as SkillManifest;

  if (!manifest?.id || !manifest?.name || !manifest?.version) {
    res.status(400).json({ error: 'Skill manifest requires id, name, version' });
    return;
  }

  const skill = installSkill(manifest);
  res.status(201).json({ skill: { ...skill, manifest_json: undefined, manifest: skill.manifest } });
});

/** DELETE /api/agent/skills/:id — 卸载 Skill */
router.delete('/skills/:id', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const ok = uninstallSkill(id);
  if (!ok) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  res.json({ ok: true });
});

/** PUT /api/agent/skills/:id/status — 启用/禁用 Skill */
router.put('/skills/:id/status', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const id = req.params['id'] as string;
  const { active } = req.body as { active?: boolean };

  if (typeof active !== 'boolean') {
    res.status(400).json({ error: 'active (boolean) is required' });
    return;
  }

  const ok = setSkillActive(id, active);
  if (!ok) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }
  res.json({ ok: true });
});

// ═══════════════════════════════════════
// Workstyle（用户工作方式文档）
// ═══════════════════════════════════════

/** GET /api/agent/workstyle — 读取当前用户的工作方式 */
router.get('/workstyle', authMiddleware, (req, res) => {
  const content = getWorkstyle(req.user!.user_id);
  res.json({ content: content ?? '' });
});

/** PUT /api/agent/workstyle — 保存当前用户的工作方式 */
router.put('/workstyle', authMiddleware, (req, res) => {
  const { content } = req.body as { content?: string };
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'content (string) is required' });
    return;
  }
  if (content.length > 10000) {
    res.status(400).json({ error: '工作方式文档不能超过 10000 字符' });
    return;
  }
  saveWorkstyle(req.user!.user_id, content);
  res.json({ ok: true });
});

// ═══════════════════════════════════════
// Tool Usage Stats
// ═══════════════════════════════════════

/**
 * GET /api/agent/tool-stats — 工具调用统计（管理员）
 * 返回：每个工具的调用次数、成功/失败数、平均耗时、最近调用时间
 * 支持 ?days=7/30/90（默认30天）
 */
router.get('/tool-stats', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const db = getDb();
  const days = Math.min(parseInt(req.query['days'] as string ?? '30'), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  // 按工具名汇总：调用数、成功数、失败数、平均耗时、最近调用
  const rows = db.prepare(`
    SELECT
      tool_name,
      COUNT(*)                                          AS calls,
      SUM(CASE WHEN tool_status = 'success' THEN 1 ELSE 0 END) AS successes,
      SUM(CASE WHEN tool_status = 'error'   THEN 1 ELSE 0 END) AS errors,
      SUM(CASE WHEN tool_status IS NULL     THEN 1 ELSE 0 END) AS unknown,
      ROUND(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 0) AS avg_ms,
      MAX(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END) AS max_ms,
      MAX(created_at)                                   AS last_called_at
    FROM session_messages
    WHERE role = 'tool_result'
      AND tool_name IS NOT NULL
      AND created_at >= ?
    GROUP BY tool_name
    ORDER BY calls DESC
  `).all(since);

  // 最近 20 条工具调用明细（仅系统级信息，不返回用户标识）
  const recent = db.prepare(`
    SELECT sm.tool_name, sm.tool_status, sm.duration_ms, sm.created_at
    FROM session_messages sm
    WHERE sm.role = 'tool_result'
      AND sm.tool_name IS NOT NULL
      AND sm.created_at >= ?
    ORDER BY sm.created_at DESC
    LIMIT 20
  `).all(since);

  // 按日期统计每天工具调用总数（折线图数据）
  const daily = db.prepare(`
    SELECT DATE(created_at) AS date, COUNT(*) AS calls,
           SUM(CASE WHEN tool_status = 'error' THEN 1 ELSE 0 END) AS errors
    FROM session_messages
    WHERE role = 'tool_result'
      AND tool_name IS NOT NULL
      AND created_at >= ?
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `).all(since);

  interface StatsRow { calls: number; successes: number; errors: number; unknown: number; avg_ms: number | null; }
  const totals = (rows as StatsRow[]).reduce((acc, r) => ({
    calls: acc.calls + r.calls,
    successes: acc.successes + r.successes,
    errors: acc.errors + r.errors,
  }), { calls: 0, successes: 0, errors: 0 });

  res.json({ days, since, totals, rows, recent, daily });
});

// ═══════════════════════════════════════
// Background Tasks
// ═══════════════════════════════════════

/** POST /api/agent/tasks — 创建后台任务，立即返回 task_id */
router.post('/tasks', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const { title, prompt } = req.body as { title?: string; prompt?: string };

  if (!title?.trim() || !prompt?.trim()) {
    res.status(400).json({ error: 'title and prompt are required' });
    return;
  }

  const taskId = createAgentTask({
    title: title.trim(),
    prompt: prompt.trim(),
    trigger_by: req.user!.user_id,
  });

  // fire-and-forget
  runAgentTaskBackground(taskId).catch(err => {
    log.error(`Background task ${taskId} unhandled error`, err);
  });

  res.status(201).json({ task_id: taskId });
});

/** GET /api/agent/tasks — 列出最近 50 条任务 */
router.get('/tasks', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const limit = Math.min(parseInt(req.query['limit'] as string) || 50, 200);
  const tasks = listAgentTasks(limit);
  res.json({ tasks });
});

/** GET /api/agent/tasks/:id — 查询单条任务状态 */
router.get('/tasks/:id', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const task = getAgentTask(req.params['id'] as string);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }
  res.json({ task });
});

/** DELETE /api/agent/tasks/:id — 取消任务 */
router.delete('/tasks/:id', authMiddleware, requireRole('owner', 'admin'), (req, res) => {
  const task = getAgentTask(req.params['id'] as string);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (task.status === 'completed' || task.status === 'failed') {
    res.status(400).json({ error: 'Cannot cancel a finished task' });
    return;
  }

  const db = getDb();
  db.prepare(`
    UPDATE agent_tasks SET status = 'cancelled', updated_at = datetime('now')
    WHERE task_id = ? AND status IN ('pending', 'running')
  `).run(task.task_id);

  res.json({ ok: true });
});

export default router;

// ─── 文件下载（token-based，供 file_attachment SSE 事件使用） ───

interface FileToken {
  path: string;
  filename: string;
  expires_at: number;
}

const fileTokens = new Map<string, FileToken>();

/** 注册一个文件 token，返回 token 字符串（5分钟有效） */
export function registerFileToken(path: string, filename: string): string {
  const token = Math.random().toString(36).slice(2) + Date.now().toString(36);
  fileTokens.set(token, { path, filename, expires_at: Date.now() + 5 * 60_000 });
  // 清理过期 token
  for (const [k, v] of fileTokens) {
    if (v.expires_at < Date.now()) fileTokens.delete(k);
  }
  return token;
}

/**
 * GET /api/agent/download-file?token=xxx
 * 通过 token 下载文件（文件路径由服务端持有，前端无法指定任意路径）
 */
router.get('/download-file', authMiddleware, (req, res) => {
  const token = req.query['token'] as string;
  if (!token) { res.status(400).json({ error: 'token required' }); return; }

  const entry = fileTokens.get(token);
  if (!entry || entry.expires_at < Date.now()) {
    fileTokens.delete(token);
    res.status(404).json({ error: '下载链接已过期，请重新获取文件' });
    return;
  }

  try {
    const stat = statSync(entry.path);
    const safeName = entry.filename.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader('Content-Length', stat.size);
    createReadStream(entry.path).pipe(res);
  } catch {
    res.status(404).json({ error: '文件不存在' });
  }
});

/**
 * POST /api/agent/download-file (保留兼容：直接下载文本内容)
 */
router.post('/download-file', authMiddleware, (req, res) => {
  const { content, filename, mime } = req.body as {
    content?: string;
    filename?: string;
    mime?: string;
  };

  if (!content || !filename) {
    res.status(400).json({ error: 'content and filename are required' });
    return;
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._\-\u4e00-\u9fa5]/g, '_');
  const contentType = mime ?? 'text/markdown; charset=utf-8';

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
  res.setHeader('Content-Length', Buffer.byteLength(content, 'utf8'));
  res.send(content);
});
