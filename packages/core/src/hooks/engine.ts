/**
 * hooks/engine.ts — Phase 3.4: Hooks Event System
 *
 * 事件驱动的 handler 系统。
 * 支持 glob pattern 匹配（如 'session:*'）。
 */
import { createLogger } from '../utils/logger.js';

const log = createLogger('hooks');

// ─── 类型 ───

export type HookEventType =
  | 'session:created'
  | 'session:archived'
  | 'session:compacting'
  | 'agent:tool_call'
  | 'agent:complete'
  | 'cron:complete'
  | 'cron:error'
  | 'gateway:startup'
  | 'gateway:shutdown';

export interface HookEvent {
  type: HookEventType;
  timestamp: number;
  data: Record<string, unknown>;
}

export type HookHandler = (event: HookEvent) => Promise<void> | void;

interface RegisteredHook {
  id: string;
  pattern: string;
  handler: HookHandler;
  /** 一次性 hook（触发后自动移除） */
  once?: boolean;
}

// ─── Registry ───

let hookIdCounter = 0;
const hooks: RegisteredHook[] = [];
let enabled = true;

/**
 * 注册 hook handler
 * @param pattern 事件模式（支持 * 通配符，如 'session:*', 'cron:*'）
 * @param handler 处理函数
 * @param opts.once 一次性 hook
 * @returns hook ID（用于 unregister）
 */
export function registerHook(
  pattern: string,
  handler: HookHandler,
  opts?: { once?: boolean },
): string {
  const id = `hook_${++hookIdCounter}`;
  hooks.push({ id, pattern, handler, once: opts?.once });
  log.info(`Hook registered: ${id} → ${pattern}`);
  return id;
}

/** 移除 hook */
export function unregisterHook(id: string): boolean {
  const idx = hooks.findIndex(h => h.id === id);
  if (idx === -1) return false;
  hooks.splice(idx, 1);
  log.info(`Hook unregistered: ${id}`);
  return true;
}

/** 设置 hooks 系统开关 */
export function setHooksEnabled(value: boolean): void {
  enabled = value;
  log.info(`Hooks system ${value ? 'enabled' : 'disabled'}`);
}

/** 获取已注册 hooks 数量 */
export function getHookCount(): number {
  return hooks.length;
}

/**
 * 触发事件 — 异步执行所有匹配的 handlers
 *
 * handler 的错误不会影响其他 handler 执行。
 */
export async function triggerHook(event: HookEvent): Promise<void> {
  if (!enabled) return;

  const matching = hooks.filter(h => matchPattern(h.pattern, event.type));
  if (matching.length === 0) return;

  log.info(`Triggering ${matching.length} hooks for ${event.type}`);

  const toRemove: string[] = [];

  await Promise.allSettled(
    matching.map(async (hook) => {
      try {
        await hook.handler(event);
        if (hook.once) toRemove.push(hook.id);
      } catch (err) {
        log.error(`Hook ${hook.id} (${hook.pattern}) failed for ${event.type}:`, err);
      }
    }),
  );

  // 清理 once hooks
  for (const id of toRemove) {
    unregisterHook(id);
  }
}

/**
 * 快捷方式：触发事件（自动填充 timestamp）
 */
export function emit(type: HookEventType, data: Record<string, unknown> = {}): void {
  triggerHook({ type, timestamp: Date.now(), data }).catch(err => {
    log.error(`Failed to emit ${type}:`, err);
  });
}

// ─── Pattern 匹配 ───

function matchPattern(pattern: string, eventType: string): boolean {
  // 完全匹配
  if (pattern === eventType) return true;

  // 通配符匹配
  if (pattern === '*') return true;

  // 前缀通配符: 'session:*' 匹配 'session:created', 'session:archived' 等
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // 'session:'
    return eventType.startsWith(prefix);
  }

  // glob 风格: '*:complete' 匹配 'agent:complete', 'cron:complete'
  if (pattern.startsWith('*:')) {
    const suffix = pattern.slice(1); // ':complete'
    return eventType.endsWith(suffix);
  }

  return false;
}
