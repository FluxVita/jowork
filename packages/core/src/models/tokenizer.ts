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

// ─── 精确价格表（USD / 1M token） ───
// 来源：Anthropic / MiniMax / Moonshot 官方定价页，按需更新
// 字段：input = 输入价格，output = 输出价格，contextWindow = 最大 context（tokens）

interface ModelPricing {
  input: number;   // USD per 1M input tokens
  output: number;  // USD per 1M output tokens
  contextWindow: number;
}

const MODEL_PRICING: Record<string, ModelPricing> = {
  // ── Anthropic / Klaude ──
  'claude-haiku-4-5-20251001':   { input: 0.80,  output: 4.00,  contextWindow: 200_000 },
  'claude-sonnet-4-20250514':    { input: 3.00,  output: 15.00, contextWindow: 200_000 },
  'claude-opus-4-20250514':      { input: 15.00, output: 75.00, contextWindow: 200_000 },
  // 旧版 fallback
  'claude-3-5-sonnet-20241022':  { input: 3.00,  output: 15.00, contextWindow: 200_000 },
  'claude-3-haiku-20240307':     { input: 0.25,  output: 1.25,  contextWindow: 200_000 },

  // ── OpenRouter ──
  'anthropic/claude-3-5-haiku':  { input: 0.80,  output: 4.00,  contextWindow: 200_000 },
  'anthropic/claude-sonnet-4-5': { input: 3.00,  output: 15.00, contextWindow: 200_000 },
  'openai/gpt-4o-mini':          { input: 0.15,  output: 0.60,  contextWindow: 128_000 },

  // ── SiliconFlow ──
  'Qwen/Qwen3-235B-A22B':        { input: 0.133, output: 0.533, contextWindow: 32_768 },
  'Qwen/Qwen3-30B-A3B':          { input: 0.035, output: 0.140, contextWindow: 32_768 },

  // ── MiniMax ──
  'MiniMax-M2.5-highspeed':      { input: 0.20,  output: 1.10,  contextWindow: 1_000_000 },

  // ── Moonshot (Kimi) ──
  'moonshot-v1-auto':            { input: 0.80,  output: 2.40,  contextWindow: 128_000 },
  'kimi-k2.5':                   { input: 0.15,  output: 2.50,  contextWindow: 128_000 },
};

/** 按模型名查价格（未知模型返回 null） */
export function getModelPricing(model: string): ModelPricing | null {
  return MODEL_PRICING[model] ?? null;
}

/** 所有已知模型的价格表（供 dashboard 展示） */
export function getAllModelPricing(): Record<string, ModelPricing> {
  return { ...MODEL_PRICING };
}

// ─── Token 估算（本地，零延迟） ───

/**
 * 估算单段文本的 token 数
 * 使用 gpt-tokenizer (cl100k_base)，对 Claude/MiniMax/Moonshot 误差约 ±5%
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  try {
    return encode(text).length;
  } catch {
    // 编码失败时用字符数 ÷ 4 粗估
    return Math.ceil(text.length / 4);
  }
}

/**
 * 估算消息数组的 prompt token 数
 * 每条消息额外加 4 token（role overhead），系统消息加 2
 */
export function estimateMessagesTokens(messages: { role: string; content: string }[]): number {
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
export function calcCost(
  model: string,
  tokensIn: number,
  tokensOut: number,
  fallbackPer1kToken = 0.002,
): number {
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
export function checkContextLimit(
  model: string,
  messages: { role: string; content: string }[],
  maxOutputTokens: number,
): { ok: boolean; estimated: number; limit: number } {
  const pricing = MODEL_PRICING[model];
  const limit = pricing?.contextWindow ?? 128_000;
  const estimated = estimateMessagesTokens(messages);
  const ok = estimated + maxOutputTokens <= limit;
  return { ok, estimated, limit };
}
