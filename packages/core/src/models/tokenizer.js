/**
 * Token 估算 + 成本计算模块
 *
 * 方案2：gpt-tokenizer 本地估算（零延迟，~5% 误差）
 * 方案3：精确 input/output 分开计价（替代原来 costPer1kToken 合并均价）
 *
 * 使用场景：
 * - 发请求前快速估算 prompt token 数，拦截超大上下文
 * - 记录成本时用 input/output 分开计价提高精度
 */
import { encode } from 'gpt-tokenizer';
const MODEL_PRICING = {
    // ── Anthropic / Klaude ──
    'claude-haiku-4-5-20251001': { input: 0.80, output: 4.00, contextWindow: 200_000 },
    'claude-sonnet-4-20250514': { input: 3.00, output: 15.00, contextWindow: 200_000 },
    'claude-opus-4-20250514': { input: 15.00, output: 75.00, contextWindow: 200_000 },
    // 旧版 fallback
    'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00, contextWindow: 200_000 },
    'claude-3-haiku-20240307': { input: 0.25, output: 1.25, contextWindow: 200_000 },
    // ── MiniMax ──
    'MiniMax-M2.5-highspeed': { input: 0.20, output: 1.10, contextWindow: 1_000_000 },
    // ── Moonshot (Kimi) ──
    'moonshot-v1-auto': { input: 0.80, output: 2.40, contextWindow: 128_000 },
    'kimi-k2.5': { input: 0.15, output: 2.50, contextWindow: 128_000 },
};
/** 按模型名查价格（未知模型返回 null） */
export function getModelPricing(model) {
    return MODEL_PRICING[model] ?? null;
}
/** 所有已知模型的价格表（供 dashboard 展示） */
export function getAllModelPricing() {
    return { ...MODEL_PRICING };
}
// ─── Token 估算（本地，零延迟） ───
/**
 * 估算单段文本的 token 数
 * 使用 gpt-tokenizer (cl100k_base)，对 Claude/MiniMax/Moonshot 误差约 ±5%
 */
export function estimateTokens(text) {
    if (!text)
        return 0;
    try {
        return encode(text).length;
    }
    catch {
        // 编码失败时用字符数 ÷ 4 粗估
        return Math.ceil(text.length / 4);
    }
}
/**
 * 估算消息数组的 prompt token 数
 * 每条消息额外加 4 token（role overhead），系统消息加 2
 */
export function estimateMessagesTokens(messages) {
    let total = 3; // 对话起始 overhead
    for (const msg of messages) {
        total += 4; // role + separator overhead
        total += estimateTokens(msg.content);
    }
    return total;
}
// ─── 成本计算 ───
/**
 * 根据模型名 + 实际 token 数计算 USD 成本
 * 优先使用精确 input/output 分开计价；未知模型 fallback 到均价估算
 */
export function calcCost(model, tokensIn, tokensOut, fallbackPer1kToken = 0.002) {
    const pricing = MODEL_PRICING[model];
    if (pricing) {
        return (tokensIn / 1_000_000) * pricing.input
            + (tokensOut / 1_000_000) * pricing.output;
    }
    // 未知模型：用 fallback 均价（输入+输出合并）
    return ((tokensIn + tokensOut) / 1000) * fallbackPer1kToken;
}
/**
 * 预检：判断 prompt 是否超出模型上下文窗口
 * 返回 { ok, estimated, limit }
 */
export function checkContextLimit(model, messages, maxOutputTokens) {
    const pricing = MODEL_PRICING[model];
    const limit = pricing?.contextWindow ?? 128_000;
    const estimated = estimateMessagesTokens(messages);
    const ok = estimated + maxOutputTokens <= limit;
    return { ok, estimated, limit };
}
//# sourceMappingURL=tokenizer.js.map