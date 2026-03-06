import type { SessionMessage } from './types.js';
import type { ToolUseMessage } from '../models/router.js';
/** 粗略 token 估算：中英混合，length/2 误差 ±20% */
export declare function estimateTokens(text: string): number;
export declare function buildArchiveTextForSummary(messages: SessionMessage[], userId: string): string;
/**
 * 检查并执行自动归档 + 摘要生成。
 * 当消息数超过阈值或 token 超预算时触发。
 */
export declare function maybeArchiveAndSummarize(sessionId: string, userId: string): Promise<void>;
/**
 * 将 SessionMessage[] 转换为 Anthropic Messages API 格式。
 *
 * 规则：
 * - tool_call → assistant message 的 { type: 'tool_use' } content block
 * - tool_result → user message 的 { type: 'tool_result' } content block
 * - 连续的同 role 消息会合并成一条
 * - 超出预算时用 session summary 代替早期消息
 */
export declare function buildContextWindow(messages: SessionMessage[], sessionSummary: string | null): ToolUseMessage[];
//# sourceMappingURL=context.d.ts.map
