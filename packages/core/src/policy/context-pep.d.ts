/**
 * Context PEP (Policy Enforcement Point)
 *
 * 防止敏感数据通过 Agent 上下文泄露。三道防线：
 *
 * 1. sanitizeToolResult — 工具返回结果进入 LLM 上下文前脱敏
 * 2. sanitizeOutput    — Agent 最终输出到渠道前检查
 * 3. getSensitivityCeiling — 根据渠道+用户确定最大可见级别
 *
 * 与 policy/engine.ts 的 checkAccess/filterByAccess 互补：
 * - engine.ts 决定"能不能看到这条数据"（对象级）
 * - context-pep.ts 决定"这段内容能不能进入 LLM / 输出到特定渠道"（内容级）
 */
import type { Role, Sensitivity } from '../types.js';
export type ChannelType = 'web' | 'feishu' | 'telegram' | 'cli';
export interface ContextPepOpts {
    userId: string;
    role: Role;
    channelType: ChannelType;
    /** 飞书群聊 vs 私聊 */
    isGroupChat?: boolean;
}
/**
 * 计算渠道+用户组合下的最大可见敏感级别。
 *
 * 规则：
 * - 飞书群聊：最多 internal（群里有多人，不能泄露 restricted）
 * - 飞书私聊：跟随用户角色
 * - Web 客户端：跟随用户角色
 * - CLI：跟随用户角色（本地操作，信任度高）
 */
export declare function getSensitivityCeiling(opts: ContextPepOpts): Sensitivity;
/** 检查某敏感级别是否在天花板以内 */
export declare function isWithinCeiling(sensitivity: Sensitivity, ceiling: Sensitivity): boolean;
/**
 * 对工具返回的内容进行脱敏处理，再传入 LLM 上下文。
 *
 * 两级处理：
 * 1. 如果工具结果带有 sensitivity 标记且超过天花板 → 整体拒绝
 * 2. 正则匹配敏感模式 → 局部替换
 */
export declare function sanitizeToolResult(content: string, opts: ContextPepOpts, 
/** 这条工具结果关联的数据对象敏感级别（如有） */
dataSensitivity?: Sensitivity): {
    content: string;
    redacted: boolean;
    redactedLabels: string[];
};
/**
 * 对 Agent 最终输出内容进行渠道安全检查。
 *
 * 与 sanitizeToolResult 不同：这里不做模式替换（内容已经过 LLM 加工），
 * 而是做最后一道检查，确保输出不包含明显的敏感模式。
 */
export declare function sanitizeOutput(content: string, opts: ContextPepOpts): {
    content: string;
    warnings: string[];
};
/**
 * 生成带有安全上下文的 system prompt 补充段。
 * 告诉模型当前用户的数据访问范围，避免模型主动引用超权限数据。
 */
export declare function getSecurityPromptSegment(opts: ContextPepOpts): string;
//# sourceMappingURL=context-pep.d.ts.map