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
interface ModelPricing {
    input: number;
    output: number;
    contextWindow: number;
}
/** 按模型名查价格（未知模型返回 null） */
export declare function getModelPricing(model: string): ModelPricing | null;
/** 所有已知模型的价格表（供 dashboard 展示） */
export declare function getAllModelPricing(): Record<string, ModelPricing>;
/**
 * 估算单段文本的 token 数
 * 使用 gpt-tokenizer (cl100k_base)，对 Claude/MiniMax/Moonshot 误差约 ±5%
 */
export declare function estimateTokens(text: string): number;
/**
 * 估算消息数组的 prompt token 数
 * 每条消息额外加 4 token（role overhead），系统消息加 2
 */
export declare function estimateMessagesTokens(messages: {
    role: string;
    content: string;
}[]): number;
/**
 * 根据模型名 + 实际 token 数计算 USD 成本
 * 优先使用精确 input/output 分开计价；未知模型 fallback 到均价估算
 */
export declare function calcCost(model: string, tokensIn: number, tokensOut: number, fallbackPer1kToken?: number): number;
/**
 * 预检：判断 prompt 是否超出模型上下文窗口
 * 返回 { ok, estimated, limit }
 */
export declare function checkContextLimit(model: string, messages: {
    role: string;
    content: string;
}[], maxOutputTokens: number): {
    ok: boolean;
    estimated: number;
    limit: number;
};
export {};
//# sourceMappingURL=tokenizer.d.ts.map