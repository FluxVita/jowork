import { Router } from 'express';
import {
  createCronTask, listCronTasks, getCronTask, updateCronTask, deleteCronTask,
} from '../../scheduler/index.js';
import { parseNaturalLanguageCron, cronToHuman } from '../../scheduler/nl-parser.js';
import { authMiddleware, requireRole } from '../middleware.js';

const router = Router();

/** GET /api/scheduler/tasks — 列出所有 Cron 任务 */
router.get('/tasks', authMiddleware, (_req, res) => {
  const tasks = listCronTasks();
  const isAdmin = ['admin', 'owner'].includes(_req.user!.role);
  const visible = isAdmin ? tasks : tasks.filter(t => t.created_by === _req.user!.user_id);
  res.json({ tasks: visible });
});

/** GET /api/scheduler/tasks/:id — 获取单个任务 */
router.get('/tasks/:id', authMiddleware, (req, res) => {
  const task = getCronTask(String(req.params['id']));
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  const isAdmin = ['admin', 'owner'].includes(req.user!.role);
  if (!isAdmin && task.created_by !== req.user!.user_id) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }
  res.json({ task });
});

/**
 * POST /api/scheduler/parse-nl — 自然语言解析预览（不创建）
 * Body: { text: "每天早上10点推送用户反馈摘要到产品群" }
 */
router.post('/parse-nl', authMiddleware, (req, res) => {
  const { text } = req.body as { text: string };
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const parsed = parseNaturalLanguageCron(text);
  if (!parsed) {
    res.status(422).json({
      error: 'Could not parse the time description',
      hint: '请使用类似「每天早上10点推送用户反馈摘要到产品群」的格式',
    });
    return;
  }

  res.json({
    parsed,
    human_readable: parsed.human_readable,
    hint: 'Use POST /api/scheduler/tasks-nl with the same text to create the task, or confirm with confirm=true',
  });
});

/**
 * POST /api/scheduler/tasks-nl — 通过自然语言创建 Cron 任务
 * Body: { text: "每天早上10点推送用户反馈摘要到产品群", confirm?: boolean }
 */
router.post('/tasks-nl', authMiddleware, (req, res) => {
  const { text, confirm } = req.body as { text: string; confirm?: boolean };
  if (!text) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const parsed = parseNaturalLanguageCron(text);
  if (!parsed) {
    res.status(422).json({
      error: 'Could not parse the time description',
      hint: '请使用类似「每天早上10点推送用户反馈摘要到产品群」的格式',
    });
    return;
  }

  // 低信心度且未确认，先返回预览让用户确认
  if (parsed.confidence < 0.7 && !confirm) {
    res.json({
      status: 'preview',
      message: '解析结果信心度偏低，请确认是否正确',
      parsed,
      human_readable: parsed.human_readable,
      hint: 'Add confirm=true to create the task',
    });
    return;
  }

  // owner 和 admin 免审批
  const autoApprove = ['owner', 'admin'].includes(req.user!.role);

  const taskId = createCronTask({
    name: parsed.name,
    cron_expr: parsed.cron_expr,
    action_type: parsed.action_type,
    action_config: parsed.action_config,
    created_by: req.user!.user_id,
    approved: autoApprove,
    enabled: autoApprove,
  });

  res.json({
    status: 'created',
    task_id: taskId,
    cron_expr: parsed.cron_expr,
    human_readable: parsed.human_readable,
    approved: autoApprove,
    message: autoApprove ? '任务已创建并启用' : '任务已创建，等待审批',
  });
});

/** POST /api/scheduler/tasks — 创建 Cron 任务（直接 cron 表达式） */
router.post('/tasks', authMiddleware, (req, res) => {
  const { name, cron_expr, action_type, action_config } = req.body as {
    name: string;
    cron_expr: string;
    action_type: string;
    action_config: Record<string, unknown>;
  };

  if (!name || !cron_expr || !action_type) {
    res.status(400).json({ error: 'name, cron_expr, action_type are required' });
    return;
  }

  // 验证 action_type 枚举
  const VALID_ACTION_TYPES = ['message', 'report', 'sync', 'custom'] as const;
  if (!VALID_ACTION_TYPES.includes(action_type as typeof VALID_ACTION_TYPES[number])) {
    res.status(400).json({ error: `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}` });
    return;
  }

  // owner 和 admin 免审批
  const autoApprove = ['owner', 'admin'].includes(req.user!.role);

  const taskId = createCronTask({
    name,
    cron_expr,
    action_type: action_type as typeof VALID_ACTION_TYPES[number],
    action_config: action_config || {},
    created_by: req.user!.user_id,
    approved: autoApprove,
    enabled: autoApprove,
  });

  res.json({
    task_id: taskId,
    approved: autoApprove,
    message: autoApprove ? 'Task created and enabled' : 'Task created, pending approval',
  });
});

/** PUT /api/scheduler/tasks/:id/approve — 审批任务 */
router.put('/tasks/:id/approve', authMiddleware, requireRole('admin', 'owner'), (req, res) => {
  const taskId = String(req.params['id']);
  const task = getCronTask(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  updateCronTask(taskId, { approved: true, enabled: true });
  res.json({ message: 'Task approved and enabled' });
});

/** PUT /api/scheduler/tasks/:id/toggle — 启用/禁用任务 */
router.put('/tasks/:id/toggle', authMiddleware, (req, res) => {
  const taskId = String(req.params['id']);
  const task = getCronTask(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  // 仅任务创建者或管理员可操作
  if (task.created_by !== req.user!.user_id && !['admin', 'owner'].includes(req.user!.role)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  updateCronTask(taskId, { enabled: !task.enabled });
  res.json({ enabled: !task.enabled });
});

/** DELETE /api/scheduler/tasks/:id — 删除任务 */
router.delete('/tasks/:id', authMiddleware, (req, res) => {
  const taskId = String(req.params['id']);
  const task = getCronTask(taskId);
  if (!task) {
    res.status(404).json({ error: 'Task not found' });
    return;
  }

  if (task.created_by !== req.user!.user_id && !['admin', 'owner'].includes(req.user!.role)) {
    res.status(403).json({ error: 'Access denied' });
    return;
  }

  deleteCronTask(taskId);
  res.json({ message: 'Task deleted' });
});

export default router;
