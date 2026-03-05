/**
 * Model Provider 注册中心
 *
 * 解耦 router.ts 中的硬编码 Provider 数组，支持动态注册。
 * 内置 Provider（Klaude/MiniMax/Moonshot）在 router.ts 中注册；
 * 第三方 Provider 通过 registerModelProvider() 动态添加。
 */

import type { TaskType } from './router.js';

export interface ModelProviderDef {
  id: string;
  name: string;
  /** 请求端点 */
  endpoint: string;
  /** API Key（直接传入，或通过 apiKeyEnv 从环境变量读取） */
  apiKey?: string;
  /** API Key 环境变量名 */
  apiKeyEnv?: string;
  /** 模型名映射（任务类型 → 模型名） */
  models: Partial<Record<TaskType, string>>;
  /** 每 1K token 的美元成本估算 */
  costPer1kToken: number;
  /** 是否为安全 provider（可处理敏感数据，如本地/私有部署） */
  isSecure?: boolean;
  /** API 格式：'openai'（默认）或 'anthropic' */
  apiFormat?: 'openai' | 'anthropic';
  /** 是否已启用 */
  enabled?: boolean;
}

// ─── 全局注册表 ───────────────────────────────────────────────────────────────

const _providers = new Map<string, ModelProviderDef>();

/** 注册一个 Model Provider */
export function registerModelProvider(def: ModelProviderDef): void {
  _providers.set(def.id, { enabled: true, ...def });
}

/** 注销一个 Model Provider */
export function unregisterModelProvider(id: string): boolean {
  return _providers.delete(id);
}

/** 获取所有已注册的 Provider */
export function getModelProviders(): ModelProviderDef[] {
  return Array.from(_providers.values());
}

/** 获取单个 Provider */
export function getModelProvider(id: string): ModelProviderDef | undefined {
  return _providers.get(id);
}

/** 更新 Provider 的启用状态 */
export function setModelProviderEnabled(id: string, enabled: boolean): void {
  const p = _providers.get(id);
  if (p) p.enabled = enabled;
}

// ─── 内置 Provider 常量（OpenAI 兼容端点供用户自配置） ─────────────────────────

/**
 * 常见 Provider 的端点模板，供用户在 UI 中快速填入。
 * Jowork 不内置这些 Provider 的 API Key，需用户自己填。
 */
export const BUILTIN_PROVIDER_TEMPLATES: Array<Pick<ModelProviderDef, 'id' | 'name' | 'endpoint' | 'apiFormat' | 'models' | 'costPer1kToken'>> = [
  {
    id: 'openai',
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    apiFormat: 'openai',
    models: {
      chat: 'gpt-4o-mini',
      code: 'gpt-4o',
      analysis: 'gpt-4o',
      writing: 'gpt-4o-mini',
    },
    costPer1kToken: 0.002,
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    apiFormat: 'anthropic',
    models: {
      chat: 'claude-haiku-4-5-20251001',
      code: 'claude-sonnet-4-6',
      analysis: 'claude-sonnet-4-6',
      writing: 'claude-haiku-4-5-20251001',
    },
    costPer1kToken: 0.003,
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    endpoint: 'http://localhost:11434/v1/chat/completions',
    apiFormat: 'openai',
    models: {
      chat: 'llama3.2',
      code: 'codellama',
    },
    costPer1kToken: 0,
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiFormat: 'openai',
    models: {
      chat: 'google/gemini-flash-1.5',
      code: 'anthropic/claude-3.5-sonnet',
      analysis: 'anthropic/claude-3.5-sonnet',
    },
    costPer1kToken: 0.001,
  },
];
