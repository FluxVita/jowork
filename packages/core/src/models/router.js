import { httpRequest } from '../utils/http.js';
import { createLogger } from '../utils/logger.js';
import { getDb } from '../datamap/db.js';
import { getUserSetting, getScopedValue, setScopedValue, getOrgSetting } from '../auth/settings.js';
import { calcCost, checkContextLimit } from './tokenizer.js';
const log = createLogger('model-router');
// ─── Model API 并发限制器 ───
// 最多 10 个并发 model API 请求，防止高峰期触发外部 rate limit
class Semaphore {
    _limit;
    _queue = [];
    _running = 0;
    constructor(_limit) {
        this._limit = _limit;
    }
    async acquire() {
        if (this._running < this._limit) {
            this._running++;
            return;
        }
        return new Promise(resolve => this._queue.push(resolve));
    }
    release() {
        const next = this._queue.shift();
        if (next) {
            next();
        }
        else {
            this._running--;
        }
    }
}
const MODEL_SEMAPHORE = new Semaphore(10);
const PROVIDERS = [
    {
        id: 'klaude',
        name: 'Klaude',
        endpoint: `${process.env['KLAUDE_URL'] ?? 'http://localhost:8899'}/v1/messages`,
        apiKeyEnv: 'KLAUDE_API_KEY',
        apiFormat: 'anthropic',
        models: {
            code: 'claude-sonnet-4-20250514',
            analysis: 'claude-opus-4-20250514',
            chat: 'claude-haiku-4-5-20251001',
            writing: 'claude-sonnet-4-20250514',
            sensitive: 'claude-sonnet-4-20250514',
        },
        costPer1kToken: 0.003,
        isSecure: true,
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
    },
];
// ─── 路由策略 ───
/** 模型选择优先级（静态默认值，可被 DB 配置覆盖） */
const TASK_PRIORITY = {
    code: ['klaude', 'minimax', 'moonshot'],
    analysis: ['klaude', 'minimax'],
    chat: ['klaude', 'minimax', 'moonshot'],
    writing: ['klaude', 'minimax', 'moonshot'],
    sensitive: ['klaude'], // 仅安全 provider
};
let _configCache = null;
let _configCacheExpiry = 0;
function getProviderRuntimeConfig() {
    if (_configCache && Date.now() < _configCacheExpiry)
        return _configCache;
    try {
        const raw = getOrgSetting('model_provider_config') ?? getUserSetting('system', 'model_provider_config');
        if (raw) {
            _configCache = JSON.parse(raw);
            _configCacheExpiry = Date.now() + 30_000;
            return _configCache;
        }
    }
    catch { /* use defaults */ }
    // 默认：全部启用，按 PROVIDERS 数组顺序
    const defaults = {};
    PROVIDERS.forEach((p, i) => { defaults[p.id] = { enabled: true, priority: i }; });
    _configCache = defaults;
    _configCacheExpiry = Date.now() + 30_000;
    return defaults;
}
// ─── Klaude 断路器 ───
// Klaude 不可达时，开路 5 分钟，避免每次请求都白白等 fetch 失败超时
const CIRCUIT_OPEN_MS = 5 * 60 * 1000; // 5 分钟
const circuits = new Map();
function isCircuitOpen(providerId) {
    const state = circuits.get(providerId);
    if (!state || state.openUntil === 0)
        return false;
    if (Date.now() > state.openUntil) {
        // 冷却结束，半开路：允许一次尝试
        state.openUntil = 0;
        return false;
    }
    return true;
}
function recordProviderFailure(providerId, err) {
    const isNetworkError = err instanceof TypeError && String(err).includes('fetch failed');
    const isConnRefused = String(err).includes('ECONNREFUSED');
    if (!isNetworkError && !isConnRefused)
        return; // 非网络错误不开路
    const state = circuits.get(providerId) ?? { openUntil: 0, failures: 0 };
    state.failures++;
    if (state.failures >= 2) {
        state.openUntil = Date.now() + CIRCUIT_OPEN_MS;
        log.warn(`[circuit] ${providerId} 不可达，断路 ${CIRCUIT_OPEN_MS / 60000} 分钟`);
    }
    circuits.set(providerId, state);
}
function recordProviderSuccess(providerId) {
    circuits.set(providerId, { openUntil: 0, failures: 0 });
}
/** 获取 provider 的 API Key（支持三层 scoped 查找，返回 key + source） */
function getProviderApiKeyWithSource(provider, userId, groupIds) {
    const settingKey = `model_api_key_${provider.id}`;
    // 1. scoped 三层查找（有 userId 时）
    if (userId) {
        try {
            const scoped = getScopedValue(settingKey, userId, groupIds ?? []);
            if (scoped)
                return { key: scoped.value, source: scoped.source };
        }
        catch { /* ignore */ }
    }
    else {
        // 系统调用：只查 org
        try {
            const org = getOrgSetting(settingKey);
            if (org)
                return { key: org, source: 'org' };
        }
        catch { /* ignore */ }
    }
    // 2. 兼容旧 user_settings 系统级（向后兼容）
    try {
        const legacy = getUserSetting('system', settingKey);
        if (legacy)
            return { key: legacy, source: 'org' };
    }
    catch { /* DB 未初始化时忽略 */ }
    // 3. 环境变量 fallback
    const envKey = process.env[provider.apiKeyEnv];
    if (envKey)
        return { key: envKey, source: 'env' };
    // 4. klaude 本地不需要 key
    if (provider.id === 'klaude')
        return { key: 'not-needed', source: 'org' };
    return null;
}
/** 简化版：只返回 key（兼容现有调用） */
function getProviderApiKey(provider) {
    return getProviderApiKeyWithSource(provider)?.key ?? null;
}
/** 确保 model_costs 表存在 */
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
    // 安全添加 task_type 列（已有表）
    try {
        db.exec(`ALTER TABLE model_costs ADD COLUMN task_type TEXT DEFAULT 'chat'`);
    }
    catch { /* column already exists */ }
}
function recordCost(record) {
    // 异步写入：成本记录不影响当前对话，延后到下一个事件循环执行
    setImmediate(() => {
        try {
            ensureCostTable();
            const db = getDb();
            db.prepare(`
        INSERT INTO model_costs (user_id, provider, model, task_type, tokens_in, tokens_out, cost_usd, date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(record.user_id, record.provider, record.model, record.task_type, record.tokens_in, record.tokens_out, record.cost_usd, record.date);
        }
        catch { /* 成本记录失败不影响主流程 */ }
    });
}
/** 获取某用户今日成本 */
function getUserDailyCost(userId) {
    ensureCostTable();
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total FROM model_costs
    WHERE user_id = ? AND date = ?
  `).get(userId, today);
    return row.total;
}
/** 获取今日总成本 */
function getTotalDailyCost() {
    ensureCostTable();
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const row = db.prepare(`
    SELECT COALESCE(SUM(cost_usd), 0) as total FROM model_costs
    WHERE date = ?
  `).get(today);
    return row.total;
}
// ─── 预算配置 ───
const DAILY_BUDGET_USD = parseFloat(process.env['BUDGET_DAILY_GLOBAL'] ?? process.env['MODEL_DAILY_BUDGET'] ?? '10');
const USER_DAILY_BUDGET_USD = parseFloat(process.env['BUDGET_DAILY_USER'] ?? process.env['MODEL_USER_DAILY_BUDGET'] ?? '3');
const MAX_TOKENS_PER_REQUEST = parseInt(process.env['MODEL_MAX_TOKENS'] ?? '4096');
/** 获取最便宜的可用 provider（预算降级用） */
function getCheapestProvider() {
    return PROVIDERS.slice().sort((a, b) => a.costPer1kToken - b.costPer1kToken)
        .find(p => p.models['chat'] && getProviderApiKey(p) !== null) ?? null;
}
/** 按动态配置排序后选择最佳 provider */
function selectProvider(taskType) {
    const runtimeCfg = getProviderRuntimeConfig();
    // 静态优先级列表决定哪些 provider 支持此任务类型
    const eligible = TASK_PRIORITY[taskType];
    // 从静态支持列表中过滤出已启用的 provider，并按动态优先级排序
    const ordered = eligible
        .map(id => PROVIDERS.find(p => p.id === id))
        .filter((p) => !!p)
        .filter(p => runtimeCfg[p.id]?.enabled !== false)
        .sort((a, b) => (runtimeCfg[a.id]?.priority ?? 999) - (runtimeCfg[b.id]?.priority ?? 999));
    for (const provider of ordered) {
        if (getProviderApiKey(provider) === null)
            continue;
        if (taskType === 'sensitive' && !provider.isSecure)
            continue;
        if (!provider.models[taskType])
            continue;
        if (isCircuitOpen(provider.id))
            continue;
        return provider;
    }
    return null;
}
/** 解析 Anthropic SSE 流，拼接完整回复 */
async function parseAnthropicSSE(response) {
    const text = await response.text();
    let content = '';
    let tokensIn = 0;
    let tokensOut = 0;
    for (const line of text.split('\n')) {
        if (!line.startsWith('data: '))
            continue;
        try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'message_start') {
                tokensIn = evt.message?.usage?.input_tokens ?? 0;
            }
            else if (evt.type === 'content_block_delta') {
                content += evt.delta?.text ?? '';
            }
            else if (evt.type === 'message_delta') {
                tokensOut = evt.usage?.output_tokens ?? 0;
            }
        }
        catch { /* skip malformed lines */ }
    }
    return { content, tokensIn, tokensOut };
}
/** 调用单个 provider（支持 OpenAI 和 Anthropic 格式） */
async function callProvider(provider, model, apiKey, messages, maxTokens) {
    await MODEL_SEMAPHORE.acquire();
    try {
        if (provider.apiFormat === 'anthropic') {
            // Anthropic Messages API — Klaude 总是返回 SSE 流
            const systemMsg = messages.find(m => m.role === 'system');
            const nonSystemMsgs = messages.filter(m => m.role !== 'system');
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 60_000);
            // 如果是 Klaude，附加 Gateway 共享密钥（防止绕过 Gateway 直接调用）
            const klaudeExtra = {};
            if (provider.id === 'klaude' && process.env['KLAUDE_GATEWAY_SECRET']) {
                klaudeExtra['X-Gateway-Secret'] = process.env['KLAUDE_GATEWAY_SECRET'];
            }
            try {
                const resp = await fetch(provider.endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-api-key': apiKey,
                        'anthropic-version': '2023-06-01',
                        ...klaudeExtra,
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
            }
            finally {
                clearTimeout(timer);
            }
        }
        // OpenAI 格式（默认）
        const resp = await httpRequest(provider.endpoint, {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}` },
            body: { model, messages, max_tokens: maxTokens },
            timeout: 60_000,
        });
        const content = resp.data.choices?.[0]?.message?.content ?? '';
        const tokensIn = resp.data.usage?.prompt_tokens ?? 0;
        const tokensOut = resp.data.usage?.completion_tokens ?? 0;
        return { content, tokensIn, tokensOut };
    }
    finally {
        MODEL_SEMAPHORE.release();
    }
}
/** 调用模型 */
export async function routeModel(req) {
    const { messages, taskType, userId, maxTokens = MAX_TOKENS_PER_REQUEST } = req;
    // 预算检查：超限时降级到最便宜模型，而非报错
    let budgetLimited = false;
    const totalCost = getTotalDailyCost();
    const userCost = getUserDailyCost(userId);
    if (totalCost >= DAILY_BUDGET_USD) {
        log.warn(`Global daily budget exceeded ($${totalCost.toFixed(2)}/$${DAILY_BUDGET_USD}), forcing cheapest model`);
        budgetLimited = true;
    }
    else if (userCost >= USER_DAILY_BUDGET_USD) {
        log.warn(`User ${userId} daily budget exceeded ($${userCost.toFixed(2)}/$${USER_DAILY_BUDGET_USD}), forcing cheapest model`);
        budgetLimited = true;
    }
    // 选择 provider（预算超限时强制用最便宜的）
    let provider;
    if (budgetLimited) {
        provider = getCheapestProvider();
        if (!provider)
            throw new Error('No cheapest provider available');
    }
    else {
        provider = selectProvider(taskType);
        if (!provider)
            throw new Error(`No available provider for task type: ${taskType}`);
    }
    const model = provider.models[budgetLimited ? 'chat' : taskType] ?? provider.models['chat'];
    const apiKey = getProviderApiKey(provider) ?? 'not-needed';
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
    }
    catch (err) {
        log.error(`Provider ${provider.id} failed, trying fallback`, err);
        recordProviderFailure(provider.id, err);
        // Failover：尝试下一个 provider
        const priority = budgetLimited ? [provider.id] : TASK_PRIORITY[taskType];
        const currentIdx = priority.indexOf(provider.id);
        for (let i = currentIdx + 1; i < priority.length; i++) {
            const fallback = PROVIDERS.find(p => p.id === priority[i]);
            if (!fallback || !fallback.models[taskType])
                continue;
            if (taskType === 'sensitive' && !fallback.isSecure)
                continue;
            if (isCircuitOpen(fallback.id))
                continue;
            const fbKey = getProviderApiKey(fallback) ?? 'not-needed';
            const fbModel = fallback.models[taskType];
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
            }
            catch (fbErr) {
                recordProviderFailure(fallback.id, fbErr);
                continue;
            }
        }
        throw new Error(`All providers failed for task type: ${taskType}`);
    }
}
// ─── 公开成本记录（供流式场景外部调用） ───
export function recordModelCost(record) {
    recordCost(record);
}
export function getKlaudeInfo() {
    const provider = PROVIDERS.find(p => p.id === 'klaude' && p.apiFormat === 'anthropic');
    if (!provider)
        return null;
    return { provider: provider.id, model: provider.models['chat'], costPer1kToken: provider.costPer1kToken };
}
/** 列出所有 provider 状态（admin 用） */
export function getProvidersStatus() {
    const cfg = getProviderRuntimeConfig();
    return PROVIDERS.map((p, idx) => {
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
            is_secure: p.isSecure,
            api_format: p.apiFormat ?? 'openai',
            models: p.models,
            circuit_open: isCircuitOpen(p.id),
        };
    });
}
/** 更新 provider 启用状态或优先级（admin 用） */
export function updateProviderConfig(providerId, update) {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider)
        throw new Error(`Unknown provider: ${providerId}`);
    const raw = getOrgSetting('model_provider_config') ?? getUserSetting('system', 'model_provider_config');
    const cfg = raw ? JSON.parse(raw) : {};
    if (!cfg[providerId])
        cfg[providerId] = { enabled: true, priority: PROVIDERS.findIndex(p => p.id === providerId) };
    if (update.enabled !== undefined)
        cfg[providerId].enabled = update.enabled;
    if (update.priority !== undefined)
        cfg[providerId].priority = update.priority;
    setScopedValue('org', 'default', 'model_provider_config', JSON.stringify(cfg));
    _configCache = null;
}
/** 更新 provider API Key — org 级（admin 用） */
export function updateProviderApiKey(providerId, key) {
    const provider = PROVIDERS.find(p => p.id === providerId);
    if (!provider)
        throw new Error(`Unknown provider: ${providerId}`);
    setScopedValue('org', 'default', `model_api_key_${providerId}`, key);
}
// ─── OpenAI 格式转换 ───
/** Anthropic tool def → OpenAI function def */
function convertToolsToOpenAI(tools) {
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
function convertMessagesToOpenAI(system, messages) {
    const result = [{ role: 'system', content: system }];
    for (const msg of messages) {
        if (typeof msg.content === 'string') {
            result.push({ role: msg.role, content: msg.content });
            continue;
        }
        // Content blocks (Anthropic format) → OpenAI flat messages
        if (msg.role === 'assistant') {
            // 收集文本和 tool_use blocks
            let text = '';
            const toolCalls = [];
            for (const block of msg.content) {
                if (block.type === 'text') {
                    text += block.text ?? '';
                }
                else if (block.type === 'tool_use') {
                    toolCalls.push({
                        id: block.id,
                        type: 'function',
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input ?? {}),
                        },
                    });
                }
            }
            if (toolCalls.length > 0) {
                result.push({ role: 'assistant', content: text || null, tool_calls: toolCalls });
            }
            else {
                result.push({ role: 'assistant', content: text });
            }
        }
        else if (msg.role === 'user') {
            // user content blocks 可能含 tool_result
            for (const block of msg.content) {
                if (block.type === 'tool_result') {
                    result.push({
                        role: 'tool',
                        tool_call_id: block.tool_use_id,
                        content: block.content ?? '',
                    });
                }
                else if (block.type === 'text') {
                    result.push({ role: 'user', content: block.text ?? '' });
                }
            }
        }
    }
    return result;
}
/** 解析 OpenAI tool_calls 响应 → 统一 ToolCallResult 格式 */
function parseOpenAIToolResponse(data) {
    const choices = data['choices'];
    const usage = data['usage'];
    if (!choices || choices.length === 0) {
        return { stop_reason: 'end_turn', content: '', tool_calls: [], tokens_in: 0, tokens_out: 0 };
    }
    const choice = choices[0];
    const message = choice.message;
    const content = message['content'] ?? '';
    const rawToolCalls = message['tool_calls'];
    const toolCalls = [];
    if (rawToolCalls) {
        for (const tc of rawToolCalls) {
            let parsedInput = {};
            try {
                parsedInput = JSON.parse(tc.function.arguments);
            }
            catch { /* empty */ }
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
async function parseAnthropicToolSSE(response) {
    const text = await response.text();
    let tokensIn = 0;
    let tokensOut = 0;
    let stopReason = 'end_turn';
    // 按 content block 收集
    const blocks = [];
    let currentBlockIdx = -1;
    for (const line of text.split('\n')) {
        if (!line.startsWith('data: '))
            continue;
        try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'message_start') {
                tokensIn = evt.message?.usage?.input_tokens ?? 0;
            }
            else if (evt.type === 'content_block_start') {
                currentBlockIdx = evt.index ?? blocks.length;
                const cb = evt.content_block;
                if (cb?.type === 'text') {
                    blocks[currentBlockIdx] = { type: 'text', text: cb.text ?? '' };
                }
                else if (cb?.type === 'tool_use') {
                    blocks[currentBlockIdx] = { type: 'tool_use', id: cb.id, name: cb.name, inputJson: '' };
                }
            }
            else if (evt.type === 'content_block_delta') {
                const idx = evt.index ?? currentBlockIdx;
                const block = blocks[idx];
                if (!block)
                    continue;
                if (evt.delta?.type === 'text_delta') {
                    block.text = (block.text ?? '') + (evt.delta.text ?? '');
                }
                else if (evt.delta?.type === 'input_json_delta') {
                    block.inputJson = (block.inputJson ?? '') + (evt.delta.partial_json ?? '');
                }
            }
            else if (evt.type === 'message_delta') {
                tokensOut = evt.usage?.output_tokens ?? 0;
                if (evt.delta?.stop_reason === 'tool_use') {
                    stopReason = 'tool_use';
                }
            }
        }
        catch { /* skip */ }
    }
    // 组装结果
    let textContent = '';
    const toolCalls = [];
    for (const block of blocks) {
        if (!block)
            continue;
        if (block.type === 'text') {
            textContent += block.text ?? '';
        }
        else if (block.type === 'tool_use') {
            let parsedInput = {};
            try {
                parsedInput = JSON.parse(block.inputJson || '{}');
            }
            catch { /* empty input */ }
            toolCalls.push({ id: block.id, name: block.name, input: parsedInput });
        }
    }
    return { stop_reason: stopReason, content: textContent, tool_calls: toolCalls, tokens_in: tokensIn, tokens_out: tokensOut };
}
/** 选择支持 tool_use 的 provider（按动态优先级排序，跳过断路中的 provider） */
function selectToolUseProvider() {
    const runtimeCfg = getProviderRuntimeConfig();
    const eligible = TASK_PRIORITY['chat'];
    const ordered = eligible
        .map(id => PROVIDERS.find(p => p.id === id))
        .filter((p) => !!p && !!p.models['chat'])
        .filter(p => runtimeCfg[p.id]?.enabled !== false)
        .sort((a, b) => (runtimeCfg[a.id]?.priority ?? 999) - (runtimeCfg[b.id]?.priority ?? 999));
    for (const provider of ordered) {
        if (getProviderApiKey(provider) === null)
            continue;
        if (isCircuitOpen(provider.id))
            continue;
        return provider;
    }
    return null;
}
/** 调用模型（带 tool definitions） — 支持 Anthropic + OpenAI 格式 */
export async function routeModelWithTools(req) {
    const { system, messages, tools, userId, maxTokens = MAX_TOKENS_PER_REQUEST } = req;
    // 预算检查
    const budgetLimited = getTotalDailyCost() >= DAILY_BUDGET_USD || getUserDailyCost(userId) >= USER_DAILY_BUDGET_USD;
    if (budgetLimited) {
        log.warn(`Budget exceeded for user ${userId}, proceeding with tool_use anyway`);
    }
    // 选择 provider
    const provider = selectToolUseProvider();
    if (!provider)
        throw new Error('No provider available for tool_use');
    const model = provider.models['chat'];
    const apiKey = getProviderApiKey(provider) ?? 'not-needed';
    log.info(`Tool-use routing to ${provider.name} (${model})`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90_000);
    try {
        let result;
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
        }
        else {
            // ── OpenAI 格式（MiniMax / Moonshot 等） ──
            const openaiMessages = convertMessagesToOpenAI(system, messages);
            const openaiTools = convertToolsToOpenAI(tools);
            const resp = await httpRequest(provider.endpoint, {
                method: 'POST',
                headers: { Authorization: `Bearer ${apiKey}` },
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
    }
    catch (err) {
        // 记录断路器失败（ECONNREFUSED / fetch failed 才开路）
        recordProviderFailure(provider.id, err);
        // Failover: 尝试下一个 provider
        const priority = TASK_PRIORITY['chat'];
        const currentIdx = priority.indexOf(provider.id);
        for (let i = currentIdx + 1; i < priority.length; i++) {
            const fallback = PROVIDERS.find(p => p.id === priority[i]);
            if (!fallback || !fallback.models['chat'])
                continue;
            const fbKey = getProviderApiKey(fallback);
            if (!fbKey)
                continue;
            if (isCircuitOpen(fallback.id))
                continue;
            log.info(`Tool-use failover to ${fallback.name}`);
            try {
                let fbResult;
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
                    if (!resp.ok)
                        continue;
                    fbResult = await parseAnthropicToolSSE(resp);
                }
                else {
                    const resp = await httpRequest(fallback.endpoint, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${fbKey}` },
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
                const costUsd = calcCost(fallback.models['chat'], fbResult.tokens_in, fbResult.tokens_out, fallback.costPer1kToken);
                recordCost({
                    user_id: userId, provider: fallback.id, model: fallback.models['chat'], task_type: 'chat',
                    tokens_in: fbResult.tokens_in, tokens_out: fbResult.tokens_out, cost_usd: costUsd,
                    date: new Date().toISOString().slice(0, 10),
                });
                recordProviderSuccess(fallback.id);
                return { ...fbResult, provider: fallback.id, model: fallback.models['chat'], cost_usd: costUsd, budget_limited: budgetLimited || undefined };
            }
            catch (fbErr) {
                recordProviderFailure(fallback.id, fbErr);
                continue;
            }
        }
        throw new Error(`All providers failed for tool_use: ${String(err)}`);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * 流式调用模型（带 tool definitions）
 * Anthropic provider: 真流式 SSE
 * 其他 provider: 伪流式（完整调用后逐步 yield）
 */
export async function* streamModelWithTools(req) {
    const { system, messages, tools, userId, maxTokens = MAX_TOKENS_PER_REQUEST } = req;
    // 预算检查
    const totalCost = getTotalDailyCost();
    if (totalCost >= DAILY_BUDGET_USD) {
        throw new Error(`Daily budget exhausted ($${totalCost.toFixed(2)}/$${DAILY_BUDGET_USD})`);
    }
    const provider = selectToolUseProvider();
    if (!provider)
        throw new Error('No provider available for streaming tool_use');
    const model = provider.models['chat'];
    const apiKey = getProviderApiKey(provider) ?? 'not-needed';
    log.info(`Stream tool-use routing to ${provider.name} (${model})`);
    if (provider.apiFormat === 'anthropic') {
        // ── Anthropic 真流式，连接失败时降级 ──
        try {
            yield* streamAnthropicToolUse(provider, model, apiKey, system, messages, tools, maxTokens);
            return;
        }
        catch (err) {
            const msg = String(err).toLowerCase();
            const isConnErr = msg.includes('fetch failed') ||
                msg.includes('econnrefused') ||
                msg.includes('enotfound') ||
                msg.includes('connect etimedout');
            if (!isConnErr)
                throw err;
            log.warn(`${provider.name} stream connection failed (${String(err)}), falling back to non-streaming provider`);
            // fall through to non-streaming path
        }
    }
    // ── 非 Anthropic 或 Anthropic 降级：伪流式（完整调用 → 模拟流事件） ──
    const result = await routeModelWithTools(req);
    yield { type: 'message_start', tokensIn: result.tokens_in };
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
async function* streamAnthropicToolUse(provider, model, apiKey, system, messages, tools, maxTokens) {
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
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';
            for (const line of lines) {
                if (!line.startsWith('data: '))
                    continue;
                const raw = line.slice(6).trim();
                if (raw === '[DONE]')
                    continue;
                let evt;
                try {
                    evt = JSON.parse(raw);
                }
                catch {
                    continue;
                }
                const evtType = evt['type'];
                if (evtType === 'message_start') {
                    const msg = evt['message'];
                    const usage = msg?.['usage'];
                    yield { type: 'message_start', tokensIn: usage?.['input_tokens'] ?? 0 };
                }
                else if (evtType === 'content_block_start') {
                    const cb = evt['content_block'];
                    if (cb?.['type'] === 'tool_use') {
                        yield { type: 'tool_use_start', id: cb['id'], name: cb['name'] };
                    }
                }
                else if (evtType === 'content_block_delta') {
                    const delta = evt['delta'];
                    if (delta?.['type'] === 'text_delta') {
                        yield { type: 'text', text: delta['text'] ?? '' };
                    }
                    else if (delta?.['type'] === 'input_json_delta') {
                        yield { type: 'tool_input_delta', json: delta['partial_json'] ?? '' };
                    }
                }
                else if (evtType === 'content_block_stop') {
                    yield { type: 'content_block_stop' };
                }
                else if (evtType === 'message_delta') {
                    const delta = evt['delta'];
                    const usage = evt['usage'];
                    yield {
                        type: 'message_delta',
                        tokensOut: usage?.['output_tokens'] ?? 0,
                        stopReason: delta?.['stop_reason'] ?? 'end_turn',
                    };
                }
            }
        }
        yield { type: 'done' };
    }
    finally {
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
  `).all(today);
    const byUser = db.prepare(`
    SELECT user_id, SUM(cost_usd) as cost FROM model_costs
    WHERE date = ? GROUP BY user_id ORDER BY cost DESC LIMIT 10
  `).all(today);
    const byTaskType = db.prepare(`
    SELECT task_type, SUM(cost_usd) as cost, COUNT(*) as requests
    FROM model_costs WHERE date = ? GROUP BY task_type ORDER BY cost DESC
  `).all(today);
    // 最近 7 天趋势
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
    const dailyTrend = db.prepare(`
    SELECT date, SUM(cost_usd) as cost, SUM(tokens_in + tokens_out) as tokens, COUNT(*) as requests
    FROM model_costs WHERE date >= ? GROUP BY date ORDER BY date
  `).all(sevenDaysAgo);
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
//# sourceMappingURL=router.js.map