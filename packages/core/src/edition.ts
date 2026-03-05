/**
 * packages/core/src/edition.ts
 *
 * 功能门控（Edition Feature Flags）
 *
 * - Free 版（默认）：基础功能，最多 5 个数据源和用户
 * - Premium 版：调用 activatePremium()（在 @jowork/premium）后解锁全部功能
 *
 * 使用方式：
 *   import { getEdition } from '@jowork/core/edition.js';
 *   if (getEdition().hasGeekMode) { ... }
 */

export interface EditionFeatures {
  maxDataSources: number;
  maxUsers: number;
  maxContextTokens: number;
  /** 可用引擎列表，Free 版只有 'builtin' */
  agentEngines: string[];
  hasVectorMemory: boolean;
  hasGeekMode: boolean;
  hasSubAgent: boolean;
  hasEventTrigger: boolean;
  hasGoalDriven: boolean;
  hasAdvancedRBAC: boolean;
  hasAuditLog: boolean;
}

/** Free 版默认配置 */
export const FREE_EDITION: EditionFeatures = {
  maxDataSources: 5,
  maxUsers: 5,
  maxContextTokens: 32_000,
  agentEngines: ['builtin'],
  hasVectorMemory: false,
  hasGeekMode: false,
  hasSubAgent: false,
  hasEventTrigger: false,
  hasGoalDriven: false,
  hasAdvancedRBAC: false,
  hasAuditLog: false,
};

let _current: EditionFeatures = { ...FREE_EDITION };

/**
 * 注册功能扩展（由 @jowork/premium 调用）。
 * 增量合并：只覆盖传入的字段，未传入的字段保持不变。
 */
export function registerEdition(features: Partial<EditionFeatures>): void {
  _current = { ..._current, ...features };
}

/** 获取当前 Edition 配置 */
export function getEdition(): EditionFeatures {
  return _current;
}

/** 重置为 Free 版（主要用于测试） */
export function resetEdition(): void {
  _current = { ...FREE_EDITION };
}
