/**
 * gateway/routes/onboarding.ts
 * Onboarding 动态状态 API
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware.js';
import { computeOnboardingStatus, markStepDone, skipStep } from '../../onboarding/service.js';
import { healthCheckAll } from '../../connectors/registry.js';

const router = Router();

/** GET /api/onboarding/status — 动态计算当前用户 onboarding 状态 */
router.get('/status', authMiddleware, async (req, res) => {
  const user = req.user!;
  const progress = computeOnboardingStatus(user);
  res.json(progress);
});

/** POST /api/onboarding/step/:key/done — 标记步骤完成 */
router.post('/step/:key/done', authMiddleware, (req, res) => {
  const user = req.user!;
  const step_key = req.params['key'] as string;
  markStepDone(user.user_id, step_key);
  const progress = computeOnboardingStatus(user);
  res.json({ ok: true, progress });
});

/** POST /api/onboarding/step/:key/skip — 跳过步骤 */
router.post('/step/:key/skip', authMiddleware, (req, res) => {
  const user = req.user!;
  const step_key = req.params['key'] as string;
  skipStep(user.user_id, step_key);
  const progress = computeOnboardingStatus(user);
  res.json({ ok: true, progress });
});

/** GET /api/onboarding/guide — 获取使用指南（保留原有接口） */
router.get('/guide', (_req, res) => {
  res.json({
    channels: [
      {
        name: '飞书 Bot',
        description: '在飞书群聊中 @fv 或在私聊中直接提问',
        setup: '无需额外配置，直接使用',
        examples: [
          '@fv PRD V3 里推送功能的设计是什么？',
          '@fv 最近有哪些未合并的 MR？',
          '@fv 帮我查一下这周的用户活跃数据',
        ],
      },
      {
        name: 'Dashboard',
        description: '公共数据看板，展示 Linear/PostHog/GitLab 数据概览',
        setup: '浏览器访问 http://<gateway>:18800/',
        examples: ['查看项目进度', '查看 PostHog 指标', '查看 GitLab 活动'],
      },
      {
        name: 'API',
        description: 'RESTful API，支持搜索数据地图、管理任务等',
        setup: '使用 JWT Token 认证，通过 /api/auth/login 获取',
        examples: [
          'GET /api/datamap/search?q=PRD',
          'POST /api/scheduler/tasks-nl (自然语言创建定时任务)',
          'GET /api/connectors/health',
        ],
      },
    ],
    data_sources: [
      { name: '飞书', types: ['文档', 'Wiki', '消息'], refresh: '事件驱动 + 每日全量' },
      { name: 'GitLab', types: ['仓库', 'MR', 'Issue'], refresh: 'Webhook + 每小时增量' },
      { name: 'Linear', types: ['项目', 'Issue'], refresh: '每小时增量' },
      { name: 'PostHog', types: ['Dashboard', 'Insight'], refresh: '每日' },
      { name: 'Figma', types: ['设计文件'], refresh: '手动注册' },
    ],
    roles: [
      { role: 'owner', description: 'CEO，全部权限' },
      { role: 'admin', description: '管理员，可管理权限' },
      { role: 'member', description: '开发者，代码/技术文档' },
      { role: 'member', description: '产品，PRD/设计' },
      { role: 'member', description: '运营/增长' },
      { role: 'member', description: '设计师，设计文件' },
      { role: 'guest', description: '只读' },
    ],
  });
});

/** GET /api/onboarding/connectors — 连接器健康状态（供 onboarding 步骤 3 使用） */
router.get('/connectors', authMiddleware, async (_req, res) => {
  const health = await healthCheckAll();
  res.json({ connectors: health });
});

export default router;
