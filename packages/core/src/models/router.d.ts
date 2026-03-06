export type TaskType = 'code' | 'analysis' | 'chat' | 'writing' | 'sensitive';
export type KeySource = 'org' | 'group' | 'user' | 'env';
interface CostRecord {
    user_id: string;
    provider: string;
    model: string;
    task_type: TaskType;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number;
    date: string;
}
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
/** 调用模型 */
export declare function routeModel(req: ModelRequest): Promise<ModelResponse>;
export declare function recordModelCost(record: CostRecord): void;
export declare function getKlaudeInfo(): {
    provider: string;
    model: string;
    costPer1kToken: number;
} | null;
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
export declare function getProvidersStatus(): ProviderStatus[];
/** 更新 provider 启用状态或优先级（admin 用） */
export declare function updateProviderConfig(providerId: string, update: {
    enabled?: boolean;
    priority?: number;
}): void;
/** 更新 provider API Key — org 级（admin 用） */
export declare function updateProviderApiKey(providerId: string, key: string): void;
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
/** 调用模型（带 tool definitions） — 支持 Anthropic + OpenAI 格式 */
export declare function routeModelWithTools(req: ToolUseRequest): Promise<ToolCallResult & {
    provider: string;
    model: string;
    cost_usd: number;
    budget_limited?: boolean;
}>;
export type StreamDelta = {
    type: 'text';
    text: string;
} | {
    type: 'tool_use_start';
    id: string;
    name: string;
} | {
    type: 'tool_input_delta';
    json: string;
} | {
    type: 'content_block_stop';
} | {
    type: 'message_start';
    tokensIn: number;
} | {
    type: 'message_delta';
    tokensOut: number;
    stopReason: string;
} | {
    type: 'done';
};
/**
 * 流式调用模型（带 tool definitions）
 * Anthropic provider: 真流式 SSE
 * 其他 provider: 伪流式（完整调用后逐步 yield）
 */
export declare function streamModelWithTools(req: ToolUseRequest): AsyncGenerator<StreamDelta>;
/** 获取模型成本看板 */
export declare function getModelCostDashboard(): {
    daily_budget: number;
    user_daily_budget: number;
    today_total: number;
    budget_ratio: number;
    by_provider: {
        provider: string;
        cost: number;
        tokens: number;
    }[];
    by_task_type: {
        task_type: string;
        cost: number;
        requests: number;
    }[];
    top_users: {
        user_id: string;
        cost: number;
    }[];
    daily_trend: {
        date: string;
        cost: number;
        tokens: number;
        requests: number;
    }[];
};
export {};
//# sourceMappingURL=router.d.ts.map