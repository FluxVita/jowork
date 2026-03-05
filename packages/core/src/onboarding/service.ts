/**
 * onboarding/service.ts
 * Onboarding 动态状态计算
 * - 6 步引导流程
 * - 步骤 3（飞书授权）和步骤 4（API Key）根据实际状态自动标记
 */
import { getDb } from '../datamap/db.js';
import { listUserSettingKeys } from '../auth/settings.js';
import type { User } from '../types.js';

export interface OnboardingStep {
  step: number;
  key: string;
  title: string;
  description: string;
  status: 'done' | 'active' | 'pending';
  auto_detected: boolean;
}

export interface OnboardingProgress {
  user_id: string;
  steps: OnboardingStep[];
  completed_count: number;
  total: number;
  is_complete: boolean;
  current_step: number;
}

const STEP_DEFINITIONS = [
  { step: 1, key: 'welcome', title: '欢迎介绍', description: '了解 Jowork AI 工作伙伴的功能与定位' },
  { step: 2, key: 'demo', title: '演示对话', description: '体验一次 AI 对话，感受数据搜索能力' },
  { step: 3, key: 'feishu_auth', title: '飞书账号授权', description: '授权飞书账号，解锁文档/Wiki/消息数据', auto: true },
  { step: 4, key: 'api_key', title: 'API Key 配置', description: '配置 AI 模型 Key，启用高级对话能力', auto: true },
  { step: 5, key: 'preferences', title: '个人偏好设置', description: '设置语言、时区、回复风格等偏好' },
  { step: 6, key: 'security', title: '安全须知确认', description: '了解数据安全策略与注意事项' },
] as const;

interface ProgressRow {
  step_key: string;
  status: string;
  completed_at: string | null;
}

function getStoredProgress(user_id: string): Map<string, ProgressRow> {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM onboarding_progress WHERE user_id = ?`).all(user_id) as ProgressRow[];
  return new Map(rows.map(r => [r.step_key, r]));
}

function upsertStep(user_id: string, step_key: string, status: 'done' | 'skipped') {
  const db = getDb();
  db.prepare(`
    INSERT INTO onboarding_progress (user_id, step_key, status, completed_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT (user_id, step_key) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at
  `).run(user_id, step_key, status);
}

/** 计算用户 onboarding 动态状态 */
export function computeOnboardingStatus(user: User): OnboardingProgress {
  const stored = getStoredProgress(user.user_id);
  const settingKeys = listUserSettingKeys(user.user_id).map(r => r.key);

  // 自动检测步骤状态
  const autoStatus: Record<string, boolean> = {
    feishu_auth: !!user.feishu_open_id, // 飞书 ID 非空即已授权
    api_key: settingKeys.some(k => k.startsWith('model_api_key_')),
  };

  const steps: OnboardingStep[] = STEP_DEFINITIONS.map(def => {
    const stored_row = stored.get(def.key);
    const is_auto = def.step === 3 || def.step === 4;

    let status: 'done' | 'active' | 'pending';
    if (is_auto && autoStatus[def.key]) {
      status = 'done';
    } else if (stored_row?.status === 'done' || stored_row?.status === 'skipped') {
      status = 'done';
    } else {
      status = 'pending';
    }

    return {
      step: def.step,
      key: def.key,
      title: def.title,
      description: def.description,
      status,
      auto_detected: is_auto,
    };
  });

  // 找第一个未完成的步骤作为 active
  const firstPending = steps.find(s => s.status === 'pending');
  if (firstPending) firstPending.status = 'active';

  const completed_count = steps.filter(s => s.status === 'done').length;
  const is_complete = completed_count === steps.length;
  const current_step = firstPending?.step ?? steps.length;

  return {
    user_id: user.user_id,
    steps,
    completed_count,
    total: steps.length,
    is_complete,
    current_step,
  };
}

/** 标记某一步为完成 */
export function markStepDone(user_id: string, step_key: string): void {
  upsertStep(user_id, step_key, 'done');
}

/** 跳过某一步 */
export function skipStep(user_id: string, step_key: string): void {
  upsertStep(user_id, step_key, 'skipped');
}
