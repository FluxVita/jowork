import type { AgentEvent, EngineType } from './types.js';
import type { Role } from '../types.js';
export interface Channel {
    id: string;
    type: 'web' | 'feishu' | 'telegram' | 'cli';
    sendText(sessionId: string, text: string): Promise<void>;
    sendTyping(sessionId: string): Promise<void>;
    sendError(sessionId: string, error: string): Promise<void>;
}
export interface AgentChatOpts {
    userId: string;
    role: Role;
    sessionId?: string;
    message: string;
    /** 随消息一起发送的图片附件 */
    images?: import('./types.js').ImageAttachment[];
    channel?: Channel;
    /** 指定引擎类型，不传则用用户默认 */
    engine?: EngineType;
    /** AbortSignal 支持中断 */
    signal?: AbortSignal;
    /** 飞书群聊标记（影响 Context PEP 策略） */
    isGroupChat?: boolean;
    /** 额外的工具定义（来自 MCP/Skills） */
    extraTools?: import('./types.js').AnthropicToolDef[];
    /** 额外的 system prompt 片段 */
    extraPrompts?: string[];
    /** 外部工具执行器（MCP/Skills 工具） */
    externalToolExecutor?: (name: string, input: Record<string, unknown>) => Promise<string>;
}
/**
 * Agent 对话主循环，返回 SSE 事件的异步生成器。
 * 根据引擎类型分发到对应引擎。
 */
export declare function agentChat(opts: AgentChatOpts): AsyncGenerator<AgentEvent>;
//# sourceMappingURL=controller.d.ts.map