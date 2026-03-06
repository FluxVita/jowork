import { createLogger } from '../utils/logger.js';
import { createEngine, getDefaultEngine } from './engines/dispatcher.js';
const log = createLogger('agent');
/**
 * Agent 对话主循环，返回 SSE 事件的异步生成器。
 * 根据引擎类型分发到对应引擎。
 */
export async function* agentChat(opts) {
    const engineType = opts.engine ?? getDefaultEngine(opts.userId);
    let engine;
    try {
        engine = await createEngine(engineType);
    }
    catch (err) {
        log.error(`Failed to create engine ${engineType}`, err);
        yield { event: 'error', data: { message: `引擎初始化失败: ${String(err)}` } };
        return;
    }
    const engineOpts = {
        userId: opts.userId,
        role: opts.role,
        sessionId: opts.sessionId ?? '',
        message: opts.message,
        images: opts.images,
        signal: opts.signal,
        extraTools: opts.extraTools,
        extraPrompts: opts.extraPrompts,
        externalToolExecutor: opts.externalToolExecutor,
        isGroupChat: opts.isGroupChat,
        channel: opts.channel ? { id: opts.channel.id, type: opts.channel.type } : undefined,
    };
    yield* engine.run(engineOpts);
}
//# sourceMappingURL=controller.js.map