/**
 * Context Compaction — prevents long conversations from exceeding context limits.
 *
 * Inspired by Pi's threshold-based compaction strategy:
 *   1. Estimate total token count of conversation history
 *   2. When approaching the limit, find a valid cut-point
 *   3. Summarize everything before the cut-point
 *   4. Keep recent messages intact
 *
 * Shared by desktop and cloud engines.
 */

import { estimateTokens } from './tokens.js';

export interface CompactableMessage {
  id: string;
  role: string;
  content: string;
  toolName?: string;
}

export interface CompactionResult {
  summary: string;
  keptMessages: CompactableMessage[];
  compactedCount: number;
  tokensSaved: number;
}

interface CompactionOpts {
  contextWindow?: number;
  reserveTokens?: number;
  keepRecentTokens?: number;
}

export function shouldCompact(
  messages: CompactableMessage[],
  opts: CompactionOpts = {},
): boolean {
  const contextWindow = opts.contextWindow ?? 100_000;
  const reserveTokens = opts.reserveTokens ?? 16_000;
  const totalTokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  return totalTokens > contextWindow - reserveTokens;
}

function findCutPoint(messages: CompactableMessage[], keepRecentTokens: number): number {
  let recentTokens = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    recentTokens += estimateTokens(messages[i].content);
    if (recentTokens >= keepRecentTokens) {
      for (let j = i; j >= 0; j--) {
        if (messages[j].role === 'user' || messages[j].role === 'assistant') return j;
      }
      return i;
    }
  }
  return 0;
}

export function compactMessages(
  messages: CompactableMessage[],
  opts: CompactionOpts = {},
): CompactionResult {
  const keepRecentTokens = opts.keepRecentTokens ?? 20_000;
  const cutPoint = findCutPoint(messages, keepRecentTokens);

  if (cutPoint <= 0) {
    return { summary: '', keptMessages: messages, compactedCount: 0, tokensSaved: 0 };
  }

  const toCompact = messages.slice(0, cutPoint);
  const toKeep = messages.slice(cutPoint);
  const summary = buildExtractiveSummary(toCompact);
  const tokensSaved = toCompact.reduce((sum, m) => sum + estimateTokens(m.content), 0) - estimateTokens(summary);

  return { summary, keptMessages: toKeep, compactedCount: toCompact.length, tokensSaved: Math.max(0, tokensSaved) };
}

function buildExtractiveSummary(messages: CompactableMessage[]): string {
  const userMessages = messages.filter((m) => m.role === 'user');
  const assistantMessages = messages.filter((m) => m.role === 'assistant');
  const toolMessages = messages.filter((m) => m.role === 'tool' || m.toolName);
  const sections: string[] = ['## 对话历史摘要\n'];

  if (userMessages.length > 0) {
    sections.push('### 用户目标');
    sections.push(userMessages.slice(0, 3).map((m) =>
      `- ${m.content.slice(0, 200).replace(/\n/g, ' ')}${m.content.length > 200 ? '…' : ''}`
    ).join('\n'));
    sections.push('');
  }

  const decisionPatterns = /决定|选择|方案|采用|使用|confirmed|decided|chose|approach|strategy/i;
  const decisions = assistantMessages
    .filter((m) => decisionPatterns.test(m.content))
    .slice(0, 5)
    .map((m) => `- ${m.content.slice(0, 200).replace(/\n/g, ' ')}${m.content.length > 200 ? '…' : ''}`);
  if (decisions.length > 0) {
    sections.push('### 关键决策');
    sections.push(decisions.join('\n'));
    sections.push('');
  }

  if (toolMessages.length > 0) {
    const toolNames = [...new Set(toolMessages.map((m) => m.toolName).filter(Boolean))];
    if (toolNames.length > 0) sections.push(`### 已使用的工具\n- ${toolNames.join('、')}\n`);
  }

  const lastExchanges = messages.slice(-4);
  if (lastExchanges.length > 0) {
    sections.push('### 最近进展');
    for (const msg of lastExchanges) {
      const prefix = msg.role === 'user' ? '用户' : msg.role === 'assistant' ? 'AI' : msg.role;
      sections.push(`- [${prefix}] ${msg.content.slice(0, 150).replace(/\n/g, ' ')}${msg.content.length > 150 ? '…' : ''}`);
    }
    sections.push('');
  }

  return sections.join('\n');
}

export function mergeSummaries(existing: string, newSummary: string): string {
  if (!existing) return newSummary;
  return `${newSummary}\n\n### 更早的历史\n\n${existing.replace(/^## 对话历史摘要\n/, '').trim()}`;
}
