import { config } from '../config.js';
import { httpRequest } from '../utils/http.js';
import { createLogger } from '../utils/logger.js';
import { getDb } from '../datamap/db.js';
import { getUserSetting, setUserSetting, getScopedValue, setScopedValue, getOrgSetting } from '../auth/settings.js';
import { calcCost, checkContextLimit } from './tokenizer.js';

const log = createLogger('model-router');

// ─── Model API 并发限制器 ───
// 最多 10 个并发 model API 请求，防止高峰期触发外部 rate limit
class Semaphore {
  private _queue: Array<() => void> = [];
  private _running = 0;
  constructor(private readonly _limit: number) {}
  async acquire(): Promise<void> {
    if (this._running < this._limit) { this._running++; return; }
    return new Promise(resolve => this._queue.push(resolve));
  }
  release(): void {
    const next = this._queue.shift();
    if (next) { next(); } else { this._running--; }
  }
}
const MODEL_SEMAPHORE = new Semaphore(10);

// ─── 模型定义 ───

export type TaskType = 'code' | 'analysis' | 'chat' | 'writing' | 'sensitive';

import { registerModelProvider, getModelProviders, type ModelProviderDef } from './provider.js';

// 兼容旧代码的内部类型别名
type ModelProvider = ModelProviderDef & { apiKeyEnv: string };

// ─── 内置 Provider 注册（启动时自动执行）─────────────────────────────────────

const _BUILTIN_PROVIDERS: ModelProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    endpoint: 'https://openrouter.ai/api/v1/chat/completions',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    apiFormat: 'openai',
    models: {
      chat: 'anthropic/claude-3-5-haiku',
      code: 'anthropic/claude-sonnet-4-5',
      analysis: 'anthropic/claude-sonnet-4-5',
      writing: 'openai/gpt-4o-mini',
      sensitive: 'anthropic/claude-3-5-haiku',
    },
    costPer1kToken: 0.001,
    isSecure: false,
    enabled: true,
  },
  {
    id: 'minimax',
    name: 'MiniMax M2.5',
    endpoint: 'https://api.minimax.chat/v1/chat/completions',
    apiKeyEnv: 'MINIMAX_API_KEY',
    models: {
      chat: 'MiniMax-M2.5-highspeed',
      code: 'MiniMax-M2.5-highspeed',
      writing: 'MiniMax-M2.5-highspeed',
      analysis: 'MiniMax-M2.5-highspeed',
    },
    costPer1kToken: 0.0008,
    isSecure: false,
    enabled: true,
  },
  {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    apiFormat: 'openai',
    models: {
      chat:     'Qwen/Qwen3-30B-A3B',
      code:     'Qwen/Qwen3-235B-A22B',
      analysis: 'Qwen/Qwen3-235B-A22B',
      writing:  'Qwen/Qwen3-30B-A3B',
    },
    costPer1kToken: 0.0003,
    isSecure: false,
    enabled: true,
  },
  {
    id: 'moonshot',
    name: 'Moonshot (Kimi)',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    models: {
      chat: 'moonshot-v1-auto',
      code: 'kimi-k2.5',
      writing: 'moonshot-v1-auto',
    },
    costPer1kToken: 0.001,
    isSecure: false,
    enabled: true,
  },
];

// 将内置 Provider 注册到动态注册中心
for (const p of _BUILTIN_PROVIDERS) {
  registerModelProvider(p);
}

/** 获取当前所有活跃 Provider（内置 + 动态注册） */
function getProviders(): ModelProvider[] {
  return getModelProviders().filter(p => p.enabled !== false) as ModelProvider[];
}

/**
 * 将 provider 追加到指定任务类型的优先级列表最前端
 * 供 premium 模块在注入专有 provider（如 klaude）时调用
 */
export function registerProviderPriority(id: string, taskTypes: TaskType[]): void {
  for (const taskType of taskTypes) {
    const list = TASK_PRIORITY[taskType];
    if (!list.includes(id)) {
      list.unshift(id);
    }
  }
}

// ─── 路由策略 ───

/** 模型选择优先级（可被 registerProviderPriority 动态修改） */
const TASK_PRIORITY: Record<TaskType, string[]> = {
  code:      ['openrouter', 'siliconflow', 'minimax', 'moonshot'],
  analysis:  ['openrouter', 'siliconflow', 'minimax'],
  chat:      ['openrouter', 'minimax', 'siliconflow', 'moonshot'],
  writing:   ['openrouter', 'siliconflow', 'minimax', 'moonshot'],
  sensitive: ['openrouter', 'minimax'],  // 优先 openrouter；premium 注入 klaude 后自动排首位
};

// ─── 动态 Provider 配置（从 DB 读取，30s 缓存）───

interface ProviderRuntimeConfig {
  [providerId: string]: { enabled: boolean; priority: number };
}

let _configCache: ProviderRuntimeConfig | null = null;
let _configCacheExpiry = 0;

function getProviderRuntimeConfig(): ProviderRuntimeConfig {
  if (_configCache && Date.now() < _configCacheExpiry) return _configCache;
  try {
    const raw = getOrgSetting('model_provider_config') ?? getUserSetting('system', 'model_provider_config');
    if (raw) {
      _configCache = JSON.parse(raw) as ProviderRuntimeConfig;
      _configCacheExpiry = Date.now() + 30_000;
      return _configCache;
    }
  } catch { /* use defaults */ }
  // 默认：全部启用，按 TASK_PRIORITY['chat'] 顺序（premium 注入 klaude 后自动排首位）
  const chatOrder = TASK_PRIORITY['chat'];
  const defaults: ProviderRuntimeConfig = {};
  getProviders().forEach((p) => {
    const idx = chatOrder.indexOf(p.id);
    defaults[p.id] = { enabled: true, priority: idx >= 0 ? idx : 999 };
  });
  _configCache = defaults;
  _configCacheExpiry = Date.now() + 30_000;
  return defaults;
}

// ─── Provider 断路器（Phase 1.5: 增强 — 支持 auth/billing/network 三类错误） ───
// 参考 OpenClaw: profile chain + independent cooldown per provider
//
// 错误分类：
// - network: ECONNREFUSED/fetch failed → 2 次开路 5 分钟
// - auth: 401/403 → 立即开路 10 分钟（auth 错误不会自愈，等待 key 刷新）
// - billing: 402/429 → 立即开路 30 分钟（配额恢复需要更长时间）

const CIRCUIT_OPEN_NETWORK_MS = 5 * 60 * 1000;  // 5 分钟
const CIRCUIT_OPEN_AUTH_MS = 10 * 60 * 1000;     // 10 分钟
const CIRCUIT_OPEN_BILLING_MS = 30 * 60 * 1000;  // 30 分钟
const NETWORK_FAILURE_THRESHOLD = 2;              // 连续 2 次网络错误才开路

type FailureReason = 'network' | 'auth' | 'billing';

interface CircuitState {
  openUntil: number;  // timestamp，0 表示闭路（正常）
  failures: number;
  lastReason?: FailureReason;
}

const circuits = new Map<string, CircuitState>();

function isCircuitOpen(providerId: string): boolean {
  const state = circuits.get(providerId);
  if (!state || state.openUntil === 0) return false;
  if (Date.now() > state.openUntil) {
    // 冷却结束，半开路：允许一次尝试
    state.openUntil = 0;
    state.failures = 0;
    return false;
  }
  return true;
}

function classifyError(err: unknown): FailureReason | null {
  const msg = String(err);
  // Auth errors: 401, 403
  if (/\b40[13]\b/.test(msg) || msg.includes('Unauthorized') || msg.includes('Forbidden')) {
    return 'auth';
  }
  // Billing errors: 402, 429
  if (/\b402\b/.test(msg) || (/\b429\b/.test(msg) && msg.includes('billing'))) {
    return 'billing';
  }
  // Network errors（含 timeout / abort — provider 超时等同于网络不可达）
  if (
    (err instanceof TypeError && msg.includes('fetch failed')) ||
    msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('ETIMEDOUT') ||
    msg.includes('aborted') || msg.includes('AbortError') || msg.includes('timeout')
  ) {
    return 'network';
  }
  return null;
}

function recordProviderFailure(providerId: string, err: unknown) {
  const reason = classifyError(err);
  if (!reason) return;

  const state = circuits.get(providerId) ?? { openUntil: 0, failures: 0 };
  state.failures++;
  state.lastReason = reason;

  switch (reason) {
    case 'auth':
      // Auth 错误立即开路
      state.openUntil = Date.now() + CIRCUIT_OPEN_AUTH_MS;
      log.warn(`[circuit] ${providerId} auth error, open for ${CIRCUIT_OPEN_AUTH_MS / 60000}min`);
      break;
    case 'billing':
      // Billing 错误立即开路
      state.openUntil = Date.now() + CIRCUIT_OPEN_BILLING_MS;
      log.warn(`[circuit] ${providerId} billing/rate limit, open for ${CIRCUIT_OPEN_BILLING_MS / 60000}min`);
      break;
    case 'network':
      // 网络错误需要连续 N 次
      if (state.failures >= NETWORK_FAILURE_THRESHOLD) {
        state.openUntil = Date.now() + CIRCUIT_OPEN_NETWORK_MS;
        log.warn(`[circuit] ${providerId} network unreachable, open for ${CIRCUIT_OPEN_NETWORK_MS / 60000}min`);
      }
      break;
  }

  circuits.set(providerId, state);
}

function recordProviderSuccess(providerId: string) {
  circuits.set(providerId, { openUntil: 0, failures: 0 });
}

// ─── API Key 统一获取 ───

export type KeySource = 'org' | 'group' | 'user' | 'env';

/** 获取 provider 的 API Key（支持三层 scoped 查找，返回 key + source） */
function getProviderApiKeyWithSource(
  provider: ModelProvider,
  userId?: string,
  groupIds?: string[],
): { key: string; source: KeySource } | null {
  const settingKey = `model_api_key_${provider.id}`;
  // 1. scoped 三层查找（有 userId 时）
  if (userId) {
    try {
      const scoped = getScopedValue(settingKey, userId, groupIds ?? []);
      if (scoped) return { key: scoped.value, source: scoped.source as KeySource };
    } catch { /* ignore */ }
  } else {
    // 系统调用：只查 org
    try {
      const org = getOrgSetting(settingKey);
      if (org) return { key: org, source: 'org' };
    } catch { /* ignore */ }
  }
  // 2. 兼容旧 user_settings 系统级（向后兼容）
  try {
    const legacy = getUserSetting('system', settingKey);
    if (legacy) return { key: legacy, source: 'org' };
  } catch { /* DB 未初始化时忽略 */ }
  // 3. 环境变量 fallback
  const envKey = process.env[provider.apiKeyEnv];
  if (envKey) return { key: envKey, source: 'env' };
  // 4. isSecure provider（如 klaude）本地不需要 key
  if (provider.isSecure) return { key: 'not-needed', source: 'org' };
  return null;
}

/** 简化版：只返回 key（兼容现有调用） */
function getProviderApiKey(provider: ModelProvider): string | null {
  return getProviderApiKeyWithSource(provider)?.key ?? null;
}

// ─── 成本追踪 ───

export interface CostRecord {
  user_id: string;
  provider: string;
  model: string;
  task_type: TaskType;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  date: string;
  behavior?: string;   // BehaviorType（可选，旧记录兜底为 'untagged'）
  tool_name?: string;  // behavior='tool_call' 时记录具体工具名
}

/** 确保 model_costs 表存在（含新字段） */
function ensureCostTable() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS model_costs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      task_type TEXT DEFAULT 'chat',
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      date TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  // 安全添加列（已有表时不报错）
  try { db.exec(`ALTER TABLE model_costs ADD COLUMN task_type TEXT DEFAULT 'chat'`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE model_costs ADD COLUMN behavior TEXT DEFAULT 'untagged'`); } catch { /* exists */ }
  try { db.exec(`ALTER TABLE model_costs ADD COLUMN tool_name TEXT`); } catch { /* exists */ }
}

function recordCost(record: CostRecord): number | undefined {
  // 同步写入以便返回 last insert rowid（积分扣减需要关联 id）
  try {
    ensureCostTable();
    const db = getDb();
    const result = db.prepare(`
      INSERT INTO model_costs (user_id, provider, model, task_type, tokens_in, tokens_out, cost_usd, date, behavior, tool_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.user_id, record.provider, record.model, record.task_type,
      record.tokens_in, record.tokens_out, record.cost_usd, record.date,
      record.behavior ?? 'untagged', record.tool_name ?? null,
    );
    return result.lastInsertRowid as number;
  } catch { /* 成本记录失败不影响主流程 */ }
  return undefined;
}

/** 获取某用户今日成本 */
function getUserDailyCost(userId: string): number {
  ensureCostTable();
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total FROM model_costs
    WHERE user_id = ? AND date = ?
  `).get(userId, today) as { total: number };
  return row.total;
}

/** 获取今日总成本 */
function getTotalDailyCost(): number {
  ensureCostTable();
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  const row = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total FROM model_costs
    WHERE date = ?
  `).get(today) as { total: number };
  return row.total;
}

// ─── 预算配置 ───

const DAILY_BUDGET_USD = parseFloat(process.env['BUDGET_DAILY_GLOBAL'] ?? process.env['MODEL_DAILY_BUDGET'] ?? '10');
const USER_DAILY_BUDGET_USD = parseFloat(process.env['BUDGET_DAILY_USER'] ?? process.env['MODEL_USER_DAILY_BUDGET'] ?? '3');
const MAX_TOKENS_PER_REQUEST = parseInt(process.env['MODEL_MAX_TOKENS'] ?? '4096');

/** 获取最便宜的可用 provider（预算降级用） */
function getCheapestProvider(): ModelProvider | null {
  return getProviders().slice().sort((a, b) => a.costPer1kToken - b.costPer1kToken)
    .find(p => p.models['chat'] && getProviderApiKey(p) !== null) ?? null;
}

// ─── 核心路由 ───

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ModelRequest {
  messages: ChatMessage[];
  taskType: TaskType;
  userId: string;
  maxTokens?: number;
}

export interface ModelResponse {
  content: string;
  provider: string;
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  budget_limited?: boolean;
}

/** 按动态配置排序后选择最佳 provider */
function selectProvider(taskType: TaskType): ModelProvider | null {
  const runtimeCfg = getProviderRuntimeConfig();
  // 静态优先级列表决定哪些 provider 支持此任务类型
  const eligible = TASK_PRIORITY[taskType];

  // 从静态支持列表中过滤出已启用的 provider，并按动态优先级排序
  const ordered = eligible
    .map(id => getProviders().find(p => p.id === id))
    .filter((p): p is ModelProvider => !!p)
    .filter(p => runtimeCfg[p.id]?.enabled !== false)
    .sort((a, b) => (runtimeCfg[a.id]?.priority ?? 999) - (runtimeCfg[b.id]?.priority ?? 999));

  // 对 sensitive 任务：优先 isSecure provider；若无则降级到任意可用 provider
  const hasSecure = ordered.some(p => p.isSecure && getProviderApiKey(p) !== null && !isCircuitOpen(p.id));
  for (const provider of ordered) {
    if (getProviderApiKey(provider) === null) continue;
    if (taskType === 'sensitive' && !provider.isSecure && hasSecure) continue;
    if (!provider.models[taskType]) continue;
    if (isCircuitOpen(provider.id)) continue;
    return provider;
  }
  return null;
}

/** 解析 Anthropic SSE 流，拼接完整回复 */
async function parseAnthropicSSE(response: Response): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  const text = await response.text();
  let content = '';
  let tokensIn = 0;
  let tokensOut = 0;

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6));
      if (evt.type === 'message_start') {
        tokensIn = evt.message?.usage?.input_tokens ?? 0;
      } else if (evt.type === 'content_block_delta') {
        content += evt.delta?.text ?? '';
      } else if (evt.type === 'message_delta') {
        tokensOut = evt.usage?.output_tokens ?? 0;
      }
    } catch { /* skip malformed lines */ }
  }

  return { content, tokensIn, tokensOut };
}

// ─── OpenRouter 用户速率限制（每用户每分钟最多 20 次请求） ───

const _orRateLimitMap = new Map<string, { count: number; windowStart: number }>();

function checkOpenRouterRateLimit(userId: string): boolean {
  const now = Date.now();
  const WINDOW_MS = 60_000;
  const MAX_REQ = 20;
  const state = _orRateLimitMap.get(userId) ?? { count: 0, windowStart: now };
  if (now - state.windowStart >= WINDOW_MS) {
    state.count = 0;
    state.windowStart = now;
  }
  state.count++;
  _orRateLimitMap.set(userId, state);
  return state.count <= MAX_REQ;
}

/** 调用单个 provider（支持 OpenAI 和 Anthropic 格式） */
async function callProvider(
  provider: ModelProvider,
  model: string,
  apiKey: string,
  messages: ChatMessage[],
  maxTokens: number,
): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
  await MODEL_SEMAPHORE.acquire();
  try {
  if (provider.apiFormat === 'anthropic') {
    // Anthropic Messages API（SSE 流）
    const systemMsg = messages.find(m => m.role === 'system');
    const nonSystemMsgs = messages.filter(m => m.role !== 'system');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);

    // isSecure provider（如 klaude）可附加 Gateway 共享密钥
    const providerExtra: Record<string, string> = {};
    if (provider.isSecure && process.env['KLAUDE_GATEWAY_SECRET']) {
      providerExtra['X-Gateway-Secret'] = process.env['KLAUDE_GATEWAY_SECRET'];
    }

    try {
      const resp = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          ...providerExtra,
        },
        body: JSON.stringify({
          model,
          max_tokens: maxTokens,
          ...(systemMsg ? { system: systemMsg.content } : {}),
          messages: nonSystemMsgs.map(m => ({ role: m.role, content: m.content })),
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        throw new Error(`Anthropic API returned ${resp.status}`);
      }

      return await parseAnthropicSSE(resp);
    } finally {
      clearTimeout(timer);
    }
  }

  // OpenAI 格式（默认）
  const openaiHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (provider.id === 'openrouter') {
    openaiHeaders['HTTP-Referer'] = 'https://jowork.work';
    openaiHeaders['X-Title'] = 'JoWork';
  }
  const resp = await httpRequest<{
    choices: { message: { content: string } }[];
    usage?: { prompt_tokens: number; completion_tokens: number };
  }>(provider.endpoint, {
    method: 'POST',
    headers: openaiHeaders,
    body: { model, messages, max_tokens: maxTokens },
    timeout: 60_000,
  });

  const content = resp.data.choices?.[0]?.message?.content ?? '';
  const tokensIn = resp.data.usage?.prompt_tokens ?? 0;
  const tokensOut = resp.data.usage?.completion_tokens ?? 0;
  return { content, tokensIn, tokensOut };
  } finally {
    MODEL_SEMAPHORE.release();
  }
}

/** 调用模型 */
export async function routeModel(req: ModelRequest): Promise<ModelResponse> {
  const { messages, taskType, userId, maxTokens = MAX_TOKENS_PER_REQUEST } = req;

  // 预算检查：超限时降级到最便宜模型，而非报错
  let budgetLimited = false;
  const totalCost = getTotalDailyCost();
  const userCost = getUserDailyCost(userId);

  if (totalCost >= DAILY_BUDGET_USD) {
    log.warn(`Global daily budget exceeded ($${totalCost.toFixed(2)}/$${DAILY_BUDGET_USD}), forcing cheapest model`);
    budgetLimited = true;
  } else if (userCost >= USER_DAILY_BUDGET_USD) {
    log.warn(`User ${userId} daily budget exceeded ($${userCost.toFixed(2)}/$${USER_DAILY_BUDGET_USD}), forcing cheapest model`);
    budgetLimited = true;
  }

  // 选择 provider（预算超限时强制用最便宜的）
  let provider: ModelProvider | null;
  if (budgetLimited) {
    provider = getCheapestProvider();
    if (!provider) throw new Error('No cheapest provider available');
  } else {
    provider = selectProvider(taskType);
    if (!provider) throw new Error(`No available provider for task type: ${taskType}`);
  }

  const model = provider.models[budgetLimited ? 'chat' : taskType] ?? provider.models['chat']!;
  const apiKey = getProviderApiKey(provider) ?? 'not-needed';

  // OpenRouter 用户速率限制
  if (provider.id === 'openrouter' && !checkOpenRouterRateLimit(userId)) {
    throw new Error('Rate limit exceeded: too many requests. Please wait a moment and try again.');
  }

  // 预检：本地估算 prompt 大小，超出上下文窗口直接拒绝
  const ctxCheck = checkContextLimit(model, messages, maxTokens);
  if (!ctxCheck.ok) {
    throw new Error(`Prompt too large: estimated ${ctxCheck.estimated} tokens + ${maxTokens} output exceeds ${ctxCheck.limit} context window for ${model}`);
  }
  log.info(`Routing ${taskType} to ${provider.name} (${model})${budgetLimited ? ' [budget-limited]' : ''} [est. ~${ctxCheck.estimated} tokens]`);

  try {
    const { content: respContent, tokensIn, tokensOut } = await callProvider(provider, model, apiKey, messages, maxTokens);
    const costUsd = calcCost(model, tokensIn, tokensOut, provider.costPer1kToken);

    // 记录成本
    recordCost({
      user_id: userId,
      provider: provider.id,
      model,
      task_type: taskType,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd,
      date: new Date().toISOString().slice(0, 10),
    });

    recordProviderSuccess(provider.id);
    return { content: respContent, provider: provider.id, model, tokens_in: tokensIn, tokens_out: tokensOut, cost_usd: costUsd, budget_limited: budgetLimited || undefined };
  } catch (err) {
    log.error(`Provider ${provider.id} failed, trying fallback`, err);
    recordProviderFailure(provider.id, err);

    // Failover：尝试下一个 provider
    const priority = budgetLimited ? [provider.id] : TASK_PRIORITY[taskType];
    const currentIdx = priority.indexOf(provider.id);
    for (let i = currentIdx + 1; i < priority.length; i++) {
      const fallback = getProviders().find(p => p.id === priority[i]);
      if (!fallback || !fallback.models[taskType]) continue;
      if (taskType === 'sensitive' && !fallback.isSecure) continue;
      if (isCircuitOpen(fallback.id)) continue;

      const fbKey = getProviderApiKey(fallback) ?? 'not-needed';
      const fbModel = fallback.models[taskType]!;

      try {
        const { content: fbContent, tokensIn: fbTokIn, tokensOut: fbTokOut } = await callProvider(fallback, fbModel, fbKey, messages, maxTokens);
        const costUsd = calcCost(fbModel, fbTokIn, fbTokOut, fallback.costPer1kToken);

        recordCost({
          user_id: userId, provider: fallback.id, model: fbModel, task_type: taskType,
          tokens_in: fbTokIn, tokens_out: fbTokOut, cost_usd: costUsd,
          date: new Date().toISOString().slice(0, 10),
        });

        log.info(`Fallback to ${fallback.name} succeeded`);
        recordProviderSuccess(fallback.id);
        return { content: fbContent, provider: fallback.id, model: fbModel, tokens_in: fbTokIn, tokens_out: fbTokOut, cost_usd: costUsd, budget_limited: budgetLimited || undefined };
      } catch (fbErr) {
        recordProviderFailure(fallback.id, fbErr);
        continue;
      }
    }

    throw new Error(`All providers failed for task type: ${taskType}`);
  }
}

// ─── 公开成本记录（供流式场景外部调用） ───

export function recordModelCost(record: CostRecord): number | undefined {
  return recordCost(record);
}

export function getKlaudeInfo(): { provider: string; model: string; costPer1kToken: number } | null {
  const provider = getProviders().find(p => p.id === 'klaude' && p.apiFormat === 'anthropic');
  if (!provider) return null;
  return { provider: provider.id, model: provider.models['chat']!, costPer1kToken: provider.costPer1kToken };
}

// ─── Admin: Provider 管理 API ───

export interface ProviderStatus {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  key_is_set: boolean;
  key_source: KeySource | null;
  can_user_override: boolean;
  is_secure: boolean;
  api_format: string;
  models: Partial<Record<TaskType, string>>;
  circuit_open: boolean;
}

/** 列出所有 provider 状态（admin 用） */
export function getProvidersStatus(): ProviderStatus[] {
  const cfg = getProviderRuntimeConfig();
  return getProviders().map((p, idx) => {
    const c = cfg[p.id] ?? { enabled: true, priority: idx };
    const keyInfo = getProviderApiKeyWithSource(p);
    return {
      id: p.id,
      name: p.name,
      enabled: c.enabled !== false,
      priority: c.priority ?? idx,
      key_is_set: keyInfo !== null,
      key_source: keyInfo?.source ?? null,
      can_user_override: keyInfo?.source !== 'org' && keyInfo?.source !== 'env',
      is_secure: p.isSecure ?? false,
      api_format: p.apiFormat ?? 'openai',
      models: p.models,
      circuit_open: isCircuitOpen(p.id),
    };
  });
}

/** 更新 provider 启用状态或优先级（admin 用） */
export function updateProviderConfig(providerId: string, update: { enabled?: boolean; priority?: number }) {
  const provider = getProviders().find(p => p.id === providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);

  const raw = getOrgSetting('model_provider_config') ?? getUserSetting('system', 'model_provider_config');
  const cfg: ProviderRuntimeConfig = raw ? JSON.parse(raw) : {};

  if (!cfg[providerId]) cfg[providerId] = { enabled: true, priority: getProviders().findIndex(p => p.id === providerId) };
  if (update.enabled !== undefined) cfg[providerId].enabled = update.enabled;
  if (update.priority !== undefined) cfg[providerId].priority = update.priority;

  setScopedValue('org', 'default', 'model_provider_config', JSON.stringify(cfg));
  _configCache = null;
}

/** 更新 provider API Key — org 级（admin 用） */
export function updateProviderApiKey(providerId: string, key: string) {
  const provider = getProviders().find(p => p.id === providerId);
  if (!provider) throw new Error(`Unknown provider: ${providerId}`);
  setScopedValue('org', 'default', `model_api_key_${providerId}`, key);
}

// ─── Tool Use 扩展 ───

import type { AnthropicToolDef, ToolCallResult } from '../agent/types.js';

export interface ToolUseMessage {
  role: 'user' | 'assistant';
  content: string | Array<{
    type: string;
    text?: string;
    id?: string;
    name?: string;
    input?: Record<string, unknown>;
    tool_use_id?: string;
    content?: string;
  }>;
}

export interface ToolUseRequest {
  system: string;
  messages: ToolUseMessage[];
  tools: AnthropicToolDef[];
  userId: string;
  maxTokens?: number;
}

// ─── OpenAI 格式转换 ───

/** Anthropic tool def → OpenAI function def */
function convertToolsToOpenAI(tools: AnthropicToolDef[]): object[] {
  return tools.map(t => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/** Anthropic content block messages → OpenAI flat messages */
function convertMessagesToOpenAI(system: string, messages: ToolUseMessage[]): object[] {
  const result: object[] = [{ role: 'system', content: system }];

  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      result.push({ role: msg.role, content: msg.content });
      continue;
    }

    // Content blocks (Anthropic format) → OpenAI flat messages
    if (msg.role === 'assistant') {
      // 收集文本和 tool_use blocks
      let text = '';
      const toolCalls: { id: string; type: 'function'; function: { name: string; arguments: string } }[] = [];

      for (const block of msg.content) {
        if (block.type === 'text') {
          text += block.text ?? '';
        } else if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id!,
            type: 'function',
            function: {
              name: block.name!,
              arguments: JSON.stringify(block.input ?? {}),
            },
          });
        }
      }

      if (toolCalls.length > 0) {
        result.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
      } else {
        result.push({ role: 'assistant', content: text });
      }
    } else if (msg.role === 'user') {
      // user content blocks 可能含 tool_result
      for (const block of msg.content) {
        if (block.type === 'tool_result') {
          result.push({
            role: 'tool',
            tool_call_id: block.tool_use_id!,
            content: block.content ?? '',
          });
        } else if (block.type === 'text') {
          result.push({ role: 'user', content: block.text ?? '' });
        }
      }
    }
  }

  return result;
}

/** 解析 OpenAI tool_calls 响应 → 统一 ToolCallResult 格式 */
function parseOpenAIToolResponse(data: Record<string, unknown>): ToolCallResult {
  const choices = data['choices'] as { message: Record<string, unknown>; finish_reason: string }[] | undefined;
  const usage = data['usage'] as { prompt_tokens: number; completion_tokens: number } | undefined;

  if (!choices || choices.length === 0) {
    return { stop_reason: 'end_turn', content: '', tool_calls: [], tokens_in: 0, tokens_out: 0 };
  }

  const choice = choices[0];
  const message = choice.message;
  const content = (message['content'] as string) ?? '';
  const rawToolCalls = message['tool_calls'] as {
    id: string;
    function: { name: string; arguments: string };
  }[] | undefined;

  const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

  if (rawToolCalls) {
    for (const tc of rawToolCalls) {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(tc.function.arguments);
      } catch { /* empty */ }
      toolCalls.push({ id: tc.id, name: tc.function.name, input: parsedInput });
    }
  }

  // OpenAI finish_reason: 'tool_calls' (复数) vs Anthropic: 'tool_use' (单数)
  const stopReason = (choice.finish_reason === 'tool_calls' || toolCalls.length > 0) ? 'tool_use' : 'end_turn';

  return {
    stop_reason: stopReason,
    content,
    tool_calls: toolCalls,
    tokens_in: usage?.prompt_tokens ?? 0,
    tokens_out: usage?.completion_tokens ?? 0,
  };
}

/** 解析 Anthropic SSE 流（带 tool_use 支持） */
async function parseAnthropicToolSSE(response: Response): Promise<ToolCallResult> {
  const text = await response.text();
  let tokensIn = 0;
  let tokensOut = 0;
  let stopReason: 'end_turn' | 'tool_use' = 'end_turn';

  // 按 content block 收集
  const blocks: Array<{ type: string; text?: string; id?: string; name?: string; inputJson?: string }> = [];
  let currentBlockIdx = -1;

  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    try {
      const evt = JSON.parse(line.slice(6));

      if (evt.type === 'message_start') {
        tokensIn = evt.message?.usage?.input_tokens ?? 0;
      } else if (evt.type === 'content_block_start') {
        currentBlockIdx = evt.index ?? blocks.length;
        const cb = evt.content_block;
        if (cb?.type === 'text') {
          blocks[currentBlockIdx] = { type: 'text', text: cb.text ?? '' };
        } else if (cb?.type === 'tool_use') {
          blocks[currentBlockIdx] = { type: 'tool_use', id: cb.id, name: cb.name, inputJson: '' };
        }
      } else if (evt.type === 'content_block_delta') {
        const idx = evt.index ?? currentBlockIdx;
        const block = blocks[idx];
        if (!block) continue;
        if (evt.delta?.type === 'text_delta') {
          block.text = (block.text ?? '') + (evt.delta.text ?? '');
        } else if (evt.delta?.type === 'input_json_delta') {
          block.inputJson = (block.inputJson ?? '') + (evt.delta.partial_json ?? '');
        }
      } else if (evt.type === 'message_delta') {
        tokensOut = evt.usage?.output_tokens ?? 0;
        if (evt.delta?.stop_reason === 'tool_use') {
          stopReason = 'tool_use';
        }
      }
    } catch { /* skip */ }
  }

  // 组装结果
  let textContent = '';
  const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

  for (const block of blocks) {
    if (!block) continue;
    if (block.type === 'text') {
      textContent += block.text ?? '';
    } else if (block.type === 'tool_use') {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(block.inputJson || '{}');
      } catch { /* empty input */ }
      toolCalls.push({ id: block.id!, name: block.name!, input: parsedInput });
    }
  }

  return { stop_reason: stopReason, content: textContent, tool_calls: toolCalls, tokens_in: tokensIn, tokens_out: tokensOut };
}

/** 选择支持 tool_use 的 provider（按动态优先级排序，跳过断路中的 provider） */
function selectToolUseProvider(): ModelProvider | null {
  const runtimeCfg = getProviderRuntimeConfig();
  const eligible = TASK_PRIORITY['chat'];

  const ordered = eligible
    .map(id => getProviders().find(p => p.id === id))
    .filter((p): p is ModelProvider => !!p && !!p.models['chat'])
    .filter(p => runtimeCfg[p.id]?.enabled !== false)
    .sort((a, b) => (runtimeCfg[a.id]?.priority ?? 999) - (runtimeCfg[b.id]?.priority ?? 999));

  for (const provider of ordered) {
    if (getProviderApiKey(provider) === null) continue;
    if (isCircuitOpen(provider.id)) continue;
    return provider;
  }
  return null;
}

/** 调用模型（带 tool definitions） — 支持 Anthropic + OpenAI 格式 */
export async function routeModelWithTools(req: ToolUseRequest): Promise<ToolCallResult & { provider: string; model: string; cost_usd: number; budget_limited?: boolean }> {
  const { system, messages, tools, userId, maxTokens = MAX_TOKENS_PER_REQUEST } = req;

  // 预算检查
  const budgetLimited = getTotalDailyCost() >= DAILY_BUDGET_USD || getUserDailyCost(userId) >= USER_DAILY_BUDGET_USD;
  if (budgetLimited) {
    log.warn(`Budget exceeded for user ${userId}, proceeding with tool_use anyway`);
  }

  // 选择 provider
  const provider = selectToolUseProvider();
  if (!provider) throw new Error('No provider available for tool_use');

  const model = provider.models['chat']!;
  const apiKey = getProviderApiKey(provider) ?? 'not-needed';

  // OpenRouter 用户速率限制（tool_use 同样计入）
  if (provider.id === 'openrouter' && !checkOpenRouterRateLimit(userId)) {
    throw new Error('Rate limit exceeded: too many requests. Please wait a moment and try again.');
  }

  log.info(`Tool-use routing to ${provider.name} (${model})`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    let result: ToolCallResult;

    if (provider.apiFormat === 'anthropic') {
      // ── Anthropic 格式 ──
      const resp = await fetch(provider.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const errBody = await resp.text().catch(() => '');
        throw new Error(`Anthropic API returned ${resp.status}: ${errBody.slice(0, 200)}`);
      }

      result = await parseAnthropicToolSSE(resp);
    } else {
      // ── OpenAI 格式（MiniMax / Moonshot / OpenRouter 等） ──
      const openaiMessages = convertMessagesToOpenAI(system, messages);
      const openaiTools = convertToolsToOpenAI(tools);
      const toolCallHeaders: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
      if (provider.id === 'openrouter') {
        toolCallHeaders['HTTP-Referer'] = 'https://jowork.work';
        toolCallHeaders['X-Title'] = 'JoWork';
      }

      const resp = await httpRequest<Record<string, unknown>>(provider.endpoint, {
        method: 'POST',
        headers: toolCallHeaders,
        body: {
          model,
          messages: openaiMessages,
          tools: openaiTools,
          tool_choice: 'auto',
          max_tokens: maxTokens,
        },
        timeout: 90_000,
      });

      result = parseOpenAIToolResponse(resp.data);
    }

    const costUsd = calcCost(model, result.tokens_in, result.tokens_out, provider.costPer1kToken);

    recordCost({
      user_id: userId,
      provider: provider.id,
      model,
      task_type: 'chat',
      tokens_in: result.tokens_in,
      tokens_out: result.tokens_out,
      cost_usd: costUsd,
      date: new Date().toISOString().slice(0, 10),
    });

    recordProviderSuccess(provider.id);
    return { ...result, provider: provider.id, model, cost_usd: costUsd, budget_limited: budgetLimited || undefined };
  } catch (err) {
    // 记录断路器失败（ECONNREFUSED / fetch failed 才开路）
    recordProviderFailure(provider.id, err);

    // Failover: 尝试下一个 provider
    const priority = TASK_PRIORITY['chat'];
    const currentIdx = priority.indexOf(provider.id);

    for (let i = currentIdx + 1; i < priority.length; i++) {
      const fallback = getProviders().find(p => p.id === priority[i]);
      if (!fallback || !fallback.models['chat']) continue;
      const fbKey = getProviderApiKey(fallback);
      if (!fbKey) continue;
      if (isCircuitOpen(fallback.id)) continue;

      log.info(`Tool-use failover to ${fallback.name}`);

      try {
        let fbResult: ToolCallResult;

        if (fallback.apiFormat === 'anthropic') {
          const resp = await fetch(fallback.endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': fbKey,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({ model: fallback.models['chat'], max_tokens: maxTokens, system, messages, tools }),
          });
          if (!resp.ok) continue;
          fbResult = await parseAnthropicToolSSE(resp);
        } else {
          const fbHeaders: Record<string, string> = { Authorization: `Bearer ${fbKey}` };
          if (fallback.id === 'openrouter') {
            fbHeaders['HTTP-Referer'] = 'https://jowork.work';
            fbHeaders['X-Title'] = 'JoWork';
          }
          const resp = await httpRequest<Record<string, unknown>>(fallback.endpoint, {
            method: 'POST',
            headers: fbHeaders,
            body: {
              model: fallback.models['chat'],
              messages: convertMessagesToOpenAI(system, messages),
              tools: convertToolsToOpenAI(tools),
              tool_choice: 'auto',
              max_tokens: maxTokens,
            },
            timeout: 90_000,
          });
          fbResult = parseOpenAIToolResponse(resp.data);
        }

        const costUsd = calcCost(fallback.models['chat']!, fbResult.tokens_in, fbResult.tokens_out, fallback.costPer1kToken);
        recordCost({
          user_id: userId, provider: fallback.id, model: fallback.models['chat']!, task_type: 'chat',
          tokens_in: fbResult.tokens_in, tokens_out: fbResult.tokens_out, cost_usd: costUsd,
          date: new Date().toISOString().slice(0, 10),
        });

        recordProviderSuccess(fallback.id);
        return { ...fbResult, provider: fallback.id, model: fallback.models['chat']!, cost_usd: costUsd, budget_limited: budgetLimited || undefined };
      } catch (fbErr) {
        recordProviderFailure(fallback.id, fbErr);
        continue;
      }
    }

    throw new Error(`All providers failed for tool_use: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

// ─── 流式 Tool Use 接口 ───

export type StreamDelta =
  | { type: 'text'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; json: string }
  | { type: 'content_block_stop' }
  | { type: 'message_start'; tokensIn: number; provider?: string; model?: string; cost_usd?: number }
  | { type: 'message_delta'; tokensOut: number; stopReason: string }
  | { type: 'done' };

/**
 * 流式调用模型（带 tool definitions）
 * Anthropic provider: 真流式 SSE
 * 其他 provider: 伪流式（完整调用后逐步 yield）
 */
export async function* streamModelWithTools(req: ToolUseRequest): AsyncGenerator<StreamDelta> {
  const { system, messages, tools, userId, maxTokens = MAX_TOKENS_PER_REQUEST } = req;

  // 预算检查
  const totalCost = getTotalDailyCost();
  if (totalCost >= DAILY_BUDGET_USD) {
    throw new Error(`Daily budget exhausted ($${totalCost.toFixed(2)}/$${DAILY_BUDGET_USD})`);
  }

  const provider = selectToolUseProvider();
  if (!provider) throw new Error('No provider available for streaming tool_use');

  const model = provider.models['chat']!;
  const apiKey = getProviderApiKey(provider) ?? 'not-needed';

  log.info(`Stream tool-use routing to ${provider.name} (${model})`);

  if (provider.apiFormat === 'anthropic') {
    // ── Anthropic 真流式，连接/超时失败时降级 ──
    try {
      yield* streamAnthropicToolUse(provider, model, apiKey, system, messages, tools, maxTokens);
      return;
    } catch (err) {
      const msg = String(err).toLowerCase();
      const isRecoverable =
        msg.includes('fetch failed') ||
        msg.includes('econnrefused') ||
        msg.includes('enotfound') ||
        msg.includes('connect etimedout') ||
        msg.includes('aborted') ||
        msg.includes('aborterror') ||
        msg.includes('timeout');
      if (!isRecoverable) throw err;
      // 记录失败到断路器，防止下一轮再选同一个 provider
      recordProviderFailure(provider.id, err);
      log.warn(`${provider.name} stream failed (${String(err)}), falling back to non-streaming provider`);
      // fall through to non-streaming path
    }
  }

  // ── 非 Anthropic 或 Anthropic 降级：伪流式（完整调用 → 模拟流事件） ──
  const result = await routeModelWithTools(req);

  // 将 provider/model/cost 信息随 message_start 传回，供 builtin.ts 展示准确成本
  yield { type: 'message_start', tokensIn: result.tokens_in, provider: result.provider, model: result.model, cost_usd: result.cost_usd };

  if (result.content) {
    const chunkSize = 20;
    for (let i = 0; i < result.content.length; i += chunkSize) {
      yield { type: 'text', text: result.content.slice(i, i + chunkSize) };
    }
  }

  for (const tc of result.tool_calls) {
    yield { type: 'tool_use_start', id: tc.id, name: tc.name };
    yield { type: 'tool_input_delta', json: JSON.stringify(tc.input) };
    yield { type: 'content_block_stop' };
  }

  yield {
    type: 'message_delta',
    tokensOut: result.tokens_out,
    stopReason: result.stop_reason === 'tool_use' ? 'tool_use' : 'end_turn',
  };

  yield { type: 'done' };
}

/** Anthropic 真流式 tool_use */
async function* streamAnthropicToolUse(
  provider: ModelProvider,
  model: string,
  apiKey: string,
  system: string,
  messages: ToolUseMessage[],
  tools: AnthropicToolDef[],
  maxTokens: number,
): AsyncGenerator<StreamDelta> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);

  try {
    const resp = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, tools, stream: true }),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Anthropic API returned ${resp.status}: ${errBody.slice(0, 200)}`);
    }

    const reader = resp.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;

        let evt: Record<string, unknown>;
        try { evt = JSON.parse(raw); } catch { continue; }

        const evtType = evt['type'] as string;

        if (evtType === 'message_start') {
          const msg = evt['message'] as Record<string, unknown> | undefined;
          const usage = msg?.['usage'] as Record<string, number> | undefined;
          yield { type: 'message_start', tokensIn: usage?.['input_tokens'] ?? 0 };
        } else if (evtType === 'content_block_start') {
          const cb = evt['content_block'] as Record<string, unknown> | undefined;
          if (cb?.['type'] === 'tool_use') {
            yield { type: 'tool_use_start', id: cb['id'] as string, name: cb['name'] as string };
          }
        } else if (evtType === 'content_block_delta') {
          const delta = evt['delta'] as Record<string, unknown> | undefined;
          if (delta?.['type'] === 'text_delta') {
            yield { type: 'text', text: (delta['text'] as string) ?? '' };
          } else if (delta?.['type'] === 'input_json_delta') {
            yield { type: 'tool_input_delta', json: (delta['partial_json'] as string) ?? '' };
          }
        } else if (evtType === 'content_block_stop') {
          yield { type: 'content_block_stop' };
        } else if (evtType === 'message_delta') {
          const delta = evt['delta'] as Record<string, unknown> | undefined;
          const usage = evt['usage'] as Record<string, number> | undefined;
          yield {
            type: 'message_delta',
            tokensOut: usage?.['output_tokens'] ?? 0,
            stopReason: (delta?.['stop_reason'] as string) ?? 'end_turn',
          };
        }
      }
    }

    yield { type: 'done' };
  } finally {
    clearTimeout(timer);
  }
}

/** 获取模型成本看板 */
export function getModelCostDashboard() {
  ensureCostTable();
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);

  const todayTotal = getTotalDailyCost();
  const byProvider = db.prepare(`
    SELECT provider, SUM(cost_usd) as cost, SUM(tokens_in + tokens_out) as tokens
    FROM model_costs WHERE date = ? GROUP BY provider
  `).all(today) as { provider: string; cost: number; tokens: number }[];

  const byUser = db.prepare(`
    SELECT user_id, SUM(cost_usd) as cost FROM model_costs
    WHERE date = ? GROUP BY user_id ORDER BY cost DESC LIMIT 10
  `).all(today) as { user_id: string; cost: number }[];

  const byTaskType = db.prepare(`
    SELECT task_type, SUM(cost_usd) as cost, COUNT(*) as requests
    FROM model_costs WHERE date = ? GROUP BY task_type ORDER BY cost DESC
  `).all(today) as { task_type: string; cost: number; requests: number }[];

  // 最近 7 天趋势
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  const dailyTrend = db.prepare(`
    SELECT date, SUM(cost_usd) as cost, SUM(tokens_in + tokens_out) as tokens, COUNT(*) as requests
    FROM model_costs WHERE date >= ? GROUP BY date ORDER BY date
  `).all(sevenDaysAgo) as { date: string; cost: number; tokens: number; requests: number }[];

  return {
    daily_budget: DAILY_BUDGET_USD,
    user_daily_budget: USER_DAILY_BUDGET_USD,
    today_total: todayTotal,
    budget_ratio: todayTotal / DAILY_BUDGET_USD,
    by_provider: byProvider,
    by_task_type: byTaskType,
    top_users: byUser,
    daily_trend: dailyTrend,
  };
}
