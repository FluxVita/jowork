/**
 * Edge API 路由 — 为 Edge sidecar（桌面端 agent loop）提供服务
 *
 * 6 个端点：
 *   POST /api/edge/session           — 创建/恢复 edge session
 *   GET  /api/edge/tools             — 返回远程工具定义（按用户权限过滤）
 *   POST /api/edge/tool              — 执行单个远程工具
 *   POST /api/edge/model             — 模型代理（streaming SSE + 成本记录）
 *   POST /api/edge/messages          — 幂等写入 edge 消息
 *   POST /api/edge/import-sessions   — 导入本地 JSON sessions（local→server 升级）
 */

import { Router } from 'express';
import { authMiddleware } from '../middleware.js';
import { createSession, getSession, appendMessage, getMessages } from '../../agent/session.js';
import { getToolDefinitions, getBuiltinTool, initTools } from '../../agent/tools/registry.js';
import { resolveServicesForUser } from '../../services/resolver.js';
import { getUserById } from '../../auth/users.js';
import { routeModelWithTools, recordModelCost, type ToolUseMessage } from '../../models/router.js';
import { checkFeatureAccess } from '../../billing/features.js';
import { createLogger } from '../../utils/logger.js';
import type { ToolContext } from '../../agent/types.js';
import type {
  EdgeSessionRequest,
  EdgeSessionResponse,
  EdgeToolRequest,
  EdgeToolResponse,
  EdgeModelRequest,
  EdgeMessagesRequest,
  EdgeMessagesResponse,
  EdgeMessage,
} from '../../agent/edge/types.js';

const log = createLogger('edge-api');
const router = Router();

// ─── 确保工具已注册（lazy init，与 builtin engine 共享同一份注册表） ───
let toolsReady = false;
function ensureToolsInit() {
  if (!toolsReady) {
    initTools();
    toolsReady = true;
  }
}

// ─── 工具分类：哪些工具是 remote（需要 Gateway 执行） ───
// local tools 不在这里暴露，由 edge sidecar 本地执行
const LOCAL_TOOL_NAMES = new Set([
  'fs_read', 'fs_write', 'fs_edit',
  'run_command', 'manage_workspace',
  'web_search', 'web_fetch',
]);

/** 过滤出远程工具定义（排除 local tools） */
function getRemoteToolDefs(userId: string, role: string) {
  ensureToolsInit();
  let toolDefs = getToolDefinitions().filter(t => !LOCAL_TOOL_NAMES.has(t.name));

  // 非 owner/admin 按服务权限过滤
  const user = getUserById(userId);
  if (user && role !== 'owner' && role !== 'admin') {
    const userServices = resolveServicesForUser(user);
    const allowedToolNames = new Set(
      userServices.filter(s => s.type === 'tool').map(s => s.config['tool_name'] as string).filter(Boolean)
    );
    if (allowedToolNames.size > 0) {
      toolDefs = toolDefs.filter(t => allowedToolNames.has(t.name));
    }
  }

  return toolDefs;
}

// ═══════════════════════════════════════
// POST /api/edge/session — 创建/恢复 edge session
// ═══════════════════════════════════════

router.post('/session', authMiddleware, (req, res) => {
  const { session_id, title } = req.body as EdgeSessionRequest;
  const user = req.user!;

  // 恢复已有 session
  if (session_id) {
    const existing = getSession(session_id);
    if (existing) {
      if (existing.user_id !== user.user_id) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }
      const response: EdgeSessionResponse = { session_id: existing.session_id, created: false };
      res.json(response);
      return;
    }
  }

  // 新建 edge session
  const session = createSession(user.user_id, title ?? 'Edge session', 'edge');
  const response: EdgeSessionResponse = { session_id: session.session_id, created: true };
  res.status(201).json(response);
});

// ═══════════════════════════════════════
// GET /api/edge/tools — 远程工具目录
// ═══════════════════════════════════════

router.get('/tools', authMiddleware, (req, res) => {
  const user = req.user!;
  const tools = getRemoteToolDefs(user.user_id, user.role);
  res.json({ tools });
});

// ═══════════════════════════════════════
// POST /api/edge/tool — 执行单个远程工具
// ═══════════════════════════════════════

router.post('/tool', authMiddleware, async (req, res) => {
  const { name, input, session_id } = req.body as EdgeToolRequest;
  const user = req.user!;

  if (!name || !session_id) {
    res.status(400).json({ error: 'name and session_id are required' });
    return;
  }

  // 验证 session 归属
  const session = getSession(session_id);
  if (!session || session.user_id !== user.user_id) {
    res.status(403).json({ error: 'Invalid session' });
    return;
  }

  // 安全检查：不允许执行 local tools
  if (LOCAL_TOOL_NAMES.has(name)) {
    res.status(400).json({ error: `Tool "${name}" is a local tool, execute it on the client side` });
    return;
  }

  // 权限检查：非 owner/admin 验证工具可访问性
  const remoteDefs = getRemoteToolDefs(user.user_id, user.role);
  if (!remoteDefs.some(t => t.name === name)) {
    res.status(403).json({ error: `Tool "${name}" is not available for your role` });
    return;
  }

  // Feature gate 检查
  const featureCheck = checkFeatureAccess(user.user_id, name as import('../../billing/features.js').FeatureKey, user.role);
  if (!featureCheck.allowed) {
    res.status(403).json({ error: `Feature "${name}" requires plan "${featureCheck.required_plan}" or higher. Current: "${featureCheck.current_plan}"` });
    return;
  }

  const ctx: ToolContext = { user_id: user.user_id, role: user.role, session_id };
  const start = Date.now();

  try {
    ensureToolsInit();
    const tool = getBuiltinTool(name);
    if (!tool) {
      res.status(404).json({ error: `Tool "${name}" not found` });
      return;
    }

    const result = await tool.execute(input ?? {}, ctx);
    const duration_ms = Date.now() - start;

    const response: EdgeToolResponse = { result, status: 'success', duration_ms };
    res.json(response);
  } catch (err) {
    const duration_ms = Date.now() - start;
    log.error(`Edge tool "${name}" failed`, err);
    const response: EdgeToolResponse = { result: String(err), status: 'error', duration_ms };
    res.status(500).json(response);
  }
});

// ═══════════════════════════════════════
// POST /api/edge/model — 模型代理（streaming SSE）
// ═══════════════════════════════════════

router.post('/model', authMiddleware, async (req, res) => {
  const { system, messages, tools, session_id, max_tokens } = req.body as EdgeModelRequest;
  const user = req.user!;

  if (!system || !messages || !session_id) {
    res.status(400).json({ error: 'system, messages, and session_id are required' });
    return;
  }

  // 验证 session 归属
  const session = getSession(session_id);
  if (!session || session.user_id !== user.user_id) {
    res.status(403).json({ error: 'Invalid session' });
    return;
  }

  try {
    // 使用现有 model router（含 circuit breaker、成本追踪）
    const result = await routeModelWithTools({
      system,
      messages: messages as ToolUseMessage[],
      tools: tools ?? [],
      userId: user.user_id,
      maxTokens: max_tokens,
    });

    // 记录成本
    recordModelCost({
      user_id: user.user_id,
      provider: result.provider,
      model: result.model,
      task_type: 'chat',
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      cost_usd: result.cost_usd,
      date: new Date().toISOString().split('T')[0]!,
      behavior: 'edge_proxy',
    });

    // 返回完整结果（非 streaming，edge sidecar 自行处理 streaming UI）
    res.json({
      stop_reason: result.stop_reason,
      content: result.content,
      tool_calls: result.tool_calls,
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      cost_usd: result.cost_usd,
      model: result.model,
      provider: result.provider,
    });
  } catch (err) {
    log.error('Edge model proxy failed', err);
    res.status(502).json({ error: String(err) });
  }
});

// ═══════════════════════════════════════
// POST /api/edge/messages — 幂等写入消息
// ═══════════════════════════════════════

/** 已接收的 client_msg_id 集合（简单去重，内存级） */
const receivedMsgIds = new Set<string>();
const MAX_MSG_IDS = 50000;

router.post('/messages', authMiddleware, (req, res) => {
  const { messages } = req.body as EdgeMessagesRequest;
  const user = req.user!;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    res.status(400).json({ error: 'messages array is required' });
    return;
  }

  let accepted = 0;
  let duplicates = 0;

  for (const msg of messages) {
    // 幂等：跳过已接收的消息
    if (msg.client_msg_id && receivedMsgIds.has(msg.client_msg_id)) {
      duplicates++;
      continue;
    }

    // 验证 session 归属
    const session = getSession(msg.session_id);
    if (!session || session.user_id !== user.user_id) {
      log.warn(`Edge message rejected: invalid session ${msg.session_id}`);
      continue;
    }

    // 追加到 session_messages
    appendMessage({
      session_id: msg.session_id,
      role: msg.role,
      content: msg.content,
      tool_name: msg.tool_name,
      tool_call_id: msg.tool_call_id,
      tool_status: msg.tool_status,
      tokens: msg.tokens ?? 0,
      model: msg.model,
      provider: msg.provider,
      cost_usd: msg.cost_usd ?? 0,
      metadata: msg.source ? { source: msg.source } : undefined,
    });

    // 记录 client_msg_id
    if (msg.client_msg_id) {
      receivedMsgIds.add(msg.client_msg_id);
      // 防止内存泄漏：超过上限时清理最旧的一半
      if (receivedMsgIds.size > MAX_MSG_IDS) {
        const arr = Array.from(receivedMsgIds);
        for (let i = 0; i < arr.length / 2; i++) {
          receivedMsgIds.delete(arr[i]!);
        }
      }
    }

    accepted++;
  }

  const response: EdgeMessagesResponse = { accepted, duplicates };
  res.json(response);
});

// ─── POST /api/edge/import-sessions（local→server 升级迁移） ───

interface ImportSession {
  session_id: string;
  title: string;
  created_at: string;
  messages: Array<{
    role: string;
    content: string;
    tool_name?: string;
    tool_call_id?: string;
    tool_status?: string;
    source?: string;
    tokens?: number;
    model?: string;
    cost_usd?: number;
    created_at?: string;
  }>;
}

router.post('/import-sessions', authMiddleware, async (req, res) => {
  const user = (req as { user?: { user_id: string } }).user;
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return; }

  const { sessions } = req.body as { sessions: ImportSession[] };
  if (!Array.isArray(sessions)) { res.status(400).json({ error: 'sessions must be an array' }); return; }

  let imported = 0;
  let skipped = 0;

  for (const s of sessions) {
    if (!s.session_id || !Array.isArray(s.messages)) { skipped++; continue; }

    // 跳过已存在的 session（幂等）
    const existing = getSession(s.session_id);
    if (existing) { skipped++; continue; }

    // 创建 session
    createSession(user.user_id, s.title || 'Imported session', 'edge', {
      sessionId: s.session_id,
    });

    // 导入消息
    for (const msg of s.messages) {
      appendMessage({
        session_id: s.session_id,
        role: msg.role as 'user' | 'assistant' | 'tool_call' | 'tool_result',
        content: msg.content || '',
        tool_name: msg.tool_name,
        tool_call_id: msg.tool_call_id,
        tool_status: msg.tool_status as 'success' | 'error' | undefined,
        tokens: msg.tokens ?? 0,
        model: msg.model,
        cost_usd: msg.cost_usd ?? 0,
        metadata: msg.source ? { source: msg.source } : undefined,
      });
    }

    imported++;
  }

  log.info('Imported local sessions', { imported, skipped, userId: user.user_id });
  res.json({ imported, skipped });
});

export default router;
