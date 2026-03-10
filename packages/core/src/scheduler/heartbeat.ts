/**
 * scheduler/heartbeat.ts — Phase 3.5: Heartbeat Mechanism
 *
 * 定期主动检查（默认 30 分钟）：
 * 1. 处理排队的 wake 事件
 * 2. 运行 pending cron agent turns
 * 3. 健康检查汇报
 */
import { createLogger } from '../utils/logger.js';
import { emit } from '../hooks/engine.js';

const log = createLogger('heartbeat');

// ─── 配置 ───

let intervalMs = 30 * 60 * 1000; // 默认 30 分钟
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let beatCount = 0;

// ─── Wake 事件队列 ───

const wakeQueue: Array<{ text: string; timestamp: number }> = [];

/** 排入 wake 事件（下次 heartbeat 处理） */
export function enqueueWake(text: string): void {
  wakeQueue.push({ text, timestamp: Date.now() });
  log.info(`Wake event queued: ${text.slice(0, 80)}`);
}

/** 获取队列中待处理的 wake 数量 */
export function getWakeQueueSize(): number {
  return wakeQueue.length;
}

// ─── Heartbeat ───

async function beat(): Promise<void> {
  beatCount++;
  log.info(`Heartbeat #${beatCount}`);

  // 1. 处理 wake 队列
  const pending = wakeQueue.splice(0, wakeQueue.length);
  if (pending.length > 0) {
    log.info(`Processing ${pending.length} queued wake events`);
    for (const w of pending) {
      emit('gateway:startup', { source: 'heartbeat', text: w.text });
    }
  }

  // 2. 基础健康数据
  const mem = process.memoryUsage();
  log.info(`Health: RSS=${(mem.rss / 1024 / 1024).toFixed(1)}MB, heap=${(mem.heapUsed / 1024 / 1024).toFixed(1)}MB, uptime=${(process.uptime() / 60).toFixed(0)}min`);
}

/** 启动 heartbeat */
export function startHeartbeat(opts?: { intervalMs?: number }): void {
  if (heartbeatTimer) return;

  if (opts?.intervalMs) {
    intervalMs = opts.intervalMs;
  }

  heartbeatTimer = setInterval(() => {
    beat().catch(err => log.error('Heartbeat failed:', err));
  }, intervalMs);

  log.info(`Heartbeat started (every ${intervalMs / 60_000}min)`);
}

/** 停止 heartbeat */
export function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
    log.info('Heartbeat stopped');
  }
}

/** 手动触发一次 heartbeat */
export async function triggerHeartbeat(): Promise<void> {
  await beat();
}
