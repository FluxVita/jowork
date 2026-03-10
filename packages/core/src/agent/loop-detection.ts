/**
 * Loop Detection — 移植自 OpenClaw tool-loop-detection.ts
 *
 * 三种检测器 + 全局断路器：
 * 1. genericRepeat — 同 tool+params 重复 N 次
 * 2. pollNoProgress — 连续调用返回相同结果（process poll/log）
 * 3. pingPong — A→B→A→B 交替模式
 * 4. globalCircuitBreaker — 任何工具无进展达到上限
 *
 * Agent-Centric 设计：
 * - warning: 注入提示信息到 system prompt，agent 决定是否调整
 * - critical: 更强烈的提示，但仍由 agent 决定
 * - 不移除工具（旧做法） — agent 保留所有选择权
 * - 唯一硬停止：token budget 耗尽 / timeout
 */

import { createHash } from 'node:crypto';
import { createLogger } from '../utils/logger.js';
import type { LoopDetectionResult, ToolCallRecord } from './types.js';

const log = createLogger('loop-detection');

// ─── 配置 ───

export const TOOL_CALL_HISTORY_SIZE = 30;
export const WARNING_THRESHOLD = 8;      // 比 OpenClaw(10) 更早警告
export const CRITICAL_THRESHOLD = 15;    // 比 OpenClaw(20) 更保守
export const GLOBAL_CIRCUIT_BREAKER_THRESHOLD = 25;

export interface LoopDetectionConfig {
  enabled: boolean;
  historySize: number;
  warningThreshold: number;
  criticalThreshold: number;
  globalCircuitBreakerThreshold: number;
  detectors: {
    genericRepeat: boolean;
    pollNoProgress: boolean;
    pingPong: boolean;
  };
}

const DEFAULT_CONFIG: LoopDetectionConfig = {
  enabled: true,
  historySize: TOOL_CALL_HISTORY_SIZE,
  warningThreshold: WARNING_THRESHOLD,
  criticalThreshold: CRITICAL_THRESHOLD,
  globalCircuitBreakerThreshold: GLOBAL_CIRCUIT_BREAKER_THRESHOLD,
  detectors: {
    genericRepeat: true,
    pollNoProgress: true,
    pingPong: true,
  },
};

// ─── Session State（维护在 engine 层） ───

export interface LoopDetectionState {
  toolCallHistory: ToolCallHistoryEntry[];
}

interface ToolCallHistoryEntry {
  toolName: string;
  argsHash: string;
  toolCallId?: string;
  resultHash?: string;
  timestamp: number;
}

// ─── Hash 工具 ───

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function digestStable(value: unknown): string {
  try {
    const serialized = stableStringify(value);
    return createHash('sha256').update(serialized).digest('hex').slice(0, 16);
  } catch {
    return createHash('sha256').update(String(value)).digest('hex').slice(0, 16);
  }
}

export function hashToolCall(toolName: string, params: unknown): string {
  return `${toolName}:${digestStable(params)}`;
}

function hashToolResult(result: string): string {
  // 取前 500 字符 hash，避免大结果消耗过多
  const input = result.length > 500 ? result.slice(0, 500) : result;
  return createHash('sha256').update(input).digest('hex').slice(0, 16);
}

// ─── 检测器 ───

/** 检测是否是 process poll/log 类轮询调用 */
function isKnownPollToolCall(toolName: string, argsHash: string): boolean {
  // 我们的 process tool 用 action 参数
  return toolName === 'process' || toolName === 'command_status';
}

/** 检测连续无进展（相同结果）的 streak */
function getNoProgressStreak(
  history: ToolCallHistoryEntry[],
  toolName: string,
  argsHash: string,
): { count: number; latestResultHash?: string } {
  let streak = 0;
  let latestResultHash: string | undefined;

  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i];
    if (record.toolName !== toolName || record.argsHash !== argsHash) continue;
    if (!record.resultHash) continue;

    if (!latestResultHash) {
      latestResultHash = record.resultHash;
      streak = 1;
      continue;
    }
    if (record.resultHash !== latestResultHash) break;
    streak++;
  }

  return { count: streak, latestResultHash };
}

/** 检测 ping-pong 交替模式 */
function getPingPongStreak(
  history: ToolCallHistoryEntry[],
  currentArgsHash: string,
): { count: number; pairedToolName?: string; noProgressEvidence: boolean } {
  if (history.length < 3) return { count: 0, noProgressEvidence: false };

  const last = history[history.length - 1];
  if (!last) return { count: 0, noProgressEvidence: false };

  // 找到上一个不同签名的调用
  let otherArgsHash: string | undefined;
  let otherToolName: string | undefined;
  for (let i = history.length - 2; i >= 0; i--) {
    const call = history[i];
    if (call.argsHash !== last.argsHash) {
      otherArgsHash = call.argsHash;
      otherToolName = call.toolName;
      break;
    }
  }

  if (!otherArgsHash || !otherToolName) return { count: 0, noProgressEvidence: false };

  // 计算交替尾部长度
  let alternatingCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const expected = alternatingCount % 2 === 0 ? last.argsHash : otherArgsHash;
    if (history[i].argsHash !== expected) break;
    alternatingCount++;
  }

  if (alternatingCount < 2) return { count: 0, noProgressEvidence: false };

  // 当前调用是否符合交替模式的下一步
  if (currentArgsHash !== otherArgsHash) {
    return { count: 0, noProgressEvidence: false };
  }

  // 检测无进展证据（两侧结果都不变）
  const tailStart = Math.max(0, history.length - alternatingCount);
  let firstHashA: string | undefined;
  let firstHashB: string | undefined;
  let noProgressEvidence = true;

  for (let i = tailStart; i < history.length; i++) {
    const call = history[i];
    if (!call.resultHash) { noProgressEvidence = false; break; }

    if (call.argsHash === last.argsHash) {
      if (!firstHashA) firstHashA = call.resultHash;
      else if (firstHashA !== call.resultHash) { noProgressEvidence = false; break; }
    } else if (call.argsHash === otherArgsHash) {
      if (!firstHashB) firstHashB = call.resultHash;
      else if (firstHashB !== call.resultHash) { noProgressEvidence = false; break; }
    }
  }

  if (!firstHashA || !firstHashB) noProgressEvidence = false;

  return {
    count: alternatingCount + 1,
    pairedToolName: last.toolName,
    noProgressEvidence,
  };
}

// ─── 公共 API ───

/**
 * 检测当前工具调用是否构成循环
 *
 * 返回 { stuck: false } 或 { stuck: true, level, detector, count, message }
 */
export function detectToolCallLoop(
  state: LoopDetectionState,
  toolName: string,
  params: unknown,
  cfg?: Partial<LoopDetectionConfig>,
): LoopDetectionResult {
  const config = { ...DEFAULT_CONFIG, ...cfg };
  if (!config.enabled) return { stuck: false };

  const history = state.toolCallHistory;
  const currentHash = hashToolCall(toolName, params);
  const noProgress = getNoProgressStreak(history, toolName, currentHash);
  const knownPoll = isKnownPollToolCall(toolName, currentHash);
  const pingPong = getPingPongStreak(history, currentHash);

  // 全局断路器
  if (noProgress.count >= config.globalCircuitBreakerThreshold) {
    log.error(`Global circuit breaker: ${toolName} repeated ${noProgress.count}x with no progress`);
    return {
      stuck: true,
      level: 'critical',
      detector: 'generic_repeat',
      count: noProgress.count,
      message: `CRITICAL: ${toolName} has repeated identical no-progress outcomes ${noProgress.count} times. You are stuck in a loop — change your approach completely or report the task as blocked.`,
    };
  }

  // 轮询无进展（critical）
  if (knownPoll && config.detectors.pollNoProgress && noProgress.count >= config.criticalThreshold) {
    log.error(`Critical polling loop: ${toolName} repeated ${noProgress.count}x`);
    return {
      stuck: true,
      level: 'critical',
      detector: 'poll_no_progress',
      count: noProgress.count,
      message: `CRITICAL: Called ${toolName} ${noProgress.count} times with identical arguments and no progress. This is a stuck polling loop — stop polling and either increase wait time or report the task as failed.`,
    };
  }

  // 轮询无进展（warning）
  if (knownPoll && config.detectors.pollNoProgress && noProgress.count >= config.warningThreshold) {
    log.warn(`Polling loop warning: ${toolName} repeated ${noProgress.count}x`);
    return {
      stuck: true,
      level: 'warning',
      detector: 'poll_no_progress',
      count: noProgress.count,
      message: `WARNING: You have called ${toolName} ${noProgress.count} times with identical arguments and no progress. Consider increasing wait time between checks, or trying a different approach.`,
    };
  }

  // Ping-pong（critical）
  if (config.detectors.pingPong && pingPong.count >= config.criticalThreshold && pingPong.noProgressEvidence) {
    log.error(`Critical ping-pong loop: ${pingPong.count} alternating calls`);
    return {
      stuck: true,
      level: 'critical',
      detector: 'ping_pong',
      count: pingPong.count,
      message: `CRITICAL: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls) with no progress. This is a ping-pong loop — stop retrying and try a completely different approach.`,
    };
  }

  // Ping-pong（warning）
  if (config.detectors.pingPong && pingPong.count >= config.warningThreshold) {
    log.warn(`Ping-pong loop warning: ${pingPong.count} alternating calls`);
    return {
      stuck: true,
      level: 'warning',
      detector: 'ping_pong',
      count: pingPong.count,
      message: `WARNING: You are alternating between repeated tool-call patterns (${pingPong.count} consecutive calls). This looks like a ping-pong loop — consider changing your strategy.`,
    };
  }

  // 通用重复（warning only）
  const recentCount = history.filter(h => h.toolName === toolName && h.argsHash === currentHash).length;
  if (!knownPoll && config.detectors.genericRepeat && recentCount >= config.warningThreshold) {
    log.warn(`Generic repeat warning: ${toolName} called ${recentCount}x with identical args`);
    return {
      stuck: true,
      level: 'warning',
      detector: 'generic_repeat',
      count: recentCount,
      message: `WARNING: You have called ${toolName} ${recentCount} times with identical arguments. If this is not making progress, stop retrying and try a different approach.`,
    };
  }

  return { stuck: false };
}

/**
 * 记录一次工具调用（调用前）
 */
export function recordToolCall(
  state: LoopDetectionState,
  toolName: string,
  params: unknown,
  toolCallId?: string,
  historySize = TOOL_CALL_HISTORY_SIZE,
): void {
  state.toolCallHistory.push({
    toolName,
    argsHash: hashToolCall(toolName, params),
    toolCallId,
    timestamp: Date.now(),
  });

  if (state.toolCallHistory.length > historySize) {
    state.toolCallHistory.shift();
  }
}

/**
 * 记录工具调用结果（调用后）
 */
export function recordToolCallOutcome(
  state: LoopDetectionState,
  toolName: string,
  params: unknown,
  result: string,
  toolCallId?: string,
  historySize = TOOL_CALL_HISTORY_SIZE,
): void {
  const argsHash = hashToolCall(toolName, params);
  const rHash = hashToolResult(result);

  // 回填最近一次匹配的 history entry
  for (let i = state.toolCallHistory.length - 1; i >= 0; i--) {
    const call = state.toolCallHistory[i];
    if (toolCallId && call.toolCallId !== toolCallId) continue;
    if (call.toolName !== toolName || call.argsHash !== argsHash) continue;
    if (call.resultHash !== undefined) continue;
    call.resultHash = rHash;
    break;
  }

  if (state.toolCallHistory.length > historySize) {
    state.toolCallHistory.splice(0, state.toolCallHistory.length - historySize);
  }
}

/**
 * 创建空的 loop detection state
 */
export function createLoopDetectionState(): LoopDetectionState {
  return { toolCallHistory: [] };
}
