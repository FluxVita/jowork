import type { MemoryRecord } from '../memory/store.js';
import { estimateTokens } from '@jowork/core';

export interface SyncedDataItem {
  title: string;
  summary: string;
  source: string;
  sourceType: string;
  uri: string;
}

interface AssembleOpts {
  memories: MemoryRecord[];
  workstyle: string;
  tokenBudget: number;
  relevantData?: SyncedDataItem[];
  connectedSources?: string[];
  contextDigest?: string;
  joworkMd?: string;
  memoryMd?: string;
  environment?: string;
}

/**
 * Assembles context from multiple sources within a token budget.
 *
 * Design principle (learned from Claude Code):
 *   - Behavioral guidance is embedded in tool descriptions (MCP server), not here
 *   - This file handles CONTEXT (what data the agent can see), not BEHAVIOR (what it should do)
 *   - Context Digest + Connected Data are placed together so agent sees
 *     "what data exists" right next to "here's data matching your question"
 */
export class ContextAssembler {
  assemble(opts: AssembleOpts): string {
    const sections: { label: string; content: string; priority: number }[] = [];
    let usedTokens = 0;

    // 0. Environment (time awareness is fundamental)
    if (opts.environment) {
      sections.push({ label: 'Current Environment', content: opts.environment, priority: 110 });
    }

    // 1. JOWORK.md (user's custom instructions — highest priority)
    if (opts.joworkMd) {
      sections.push({ label: 'JOWORK.md', content: opts.joworkMd, priority: 105 });
    }

    // 2. Workstyle
    if (opts.workstyle) {
      sections.push({ label: 'Work Style', content: opts.workstyle, priority: 100 });
    }

    // 3. MEMORY.md (persistent cross-session memory)
    if (opts.memoryMd) {
      sections.push({ label: 'MEMORY.md', content: opts.memoryMd, priority: 95 });
    }

    // 4. Data Awareness Block: Digest + Connected Data together
    const dataAwareness = this.buildDataAwarenessBlock(opts);
    if (dataAwareness) {
      sections.push({ label: 'Data Awareness', content: dataAwareness, priority: 92 });
    }

    // 5. Pinned memories
    const pinned = opts.memories.filter((m) => m.pinned);
    if (pinned.length > 0) {
      const content = pinned.map((m) => `- **${m.title}**: ${m.content}`).join('\n');
      sections.push({ label: 'Pinned Memories', content, priority: 90 });
    }

    // 6. Recent memories (not pinned)
    const recent = opts.memories
      .filter((m) => !m.pinned)
      .sort((a, b) => {
        const pa = 30 + Math.min((a.accessCount ?? 0) * 5, 20);
        const pb = 30 + Math.min((b.accessCount ?? 0) * 5, 20);
        return pb - pa;
      })
      .slice(0, 10);
    if (recent.length > 0) {
      const content = recent.map((m) => `- ${m.title}: ${m.content}`).join('\n');
      sections.push({ label: 'Recent Memories', content, priority: 30 });
    }

    // Assemble within budget, highest priority first
    sections.sort((a, b) => b.priority - a.priority);

    const result: string[] = [];

    // Core behavioral principle
    result.push(
      '## Operating Principle\n',
      '基于数据说话。不确定的事先查再答，查不到就告诉用户缺什么数据。',
      '跨数据源思考：关联时间线、人物、决策链，主动指出矛盾。',
      '当数据中包含外部链接（URL）时，主动用 WebFetch 抓取内容并总结。\n',
    );

    for (const section of sections) {
      const sectionText = `## ${section.label}\n\n${section.content}\n`;
      const tokens = estimateTokens(sectionText);
      if (usedTokens + tokens > opts.tokenBudget) {
        const remaining = opts.tokenBudget - usedTokens;
        if (remaining > 50) {
          const truncated = section.content.slice(0, remaining * 3);
          result.push(`## ${section.label}\n\n${truncated}...\n`);
        }
        break;
      }
      result.push(sectionText);
      usedTokens += tokens;
    }

    return result.join('\n');
  }

  /**
   * Build the Data Awareness block — merges Context Digest + Connected Data
   * into one coherent section so the agent sees the full picture.
   */
  private buildDataAwarenessBlock(opts: AssembleOpts): string | null {
    const parts: string[] = [];

    // Connected sources declaration
    if (opts.connectedSources && opts.connectedSources.length > 0) {
      parts.push(`已连接数据源：${opts.connectedSources.join('、')}`);
    }

    // Context Digest (what data exists globally)
    if (opts.contextDigest) {
      parts.push(opts.contextDigest);
    }

    // Auto-retrieved data matching user's question
    if (opts.relevantData && opts.relevantData.length > 0) {
      parts.push('### 与你的问题相关的数据\n');
      parts.push(
        opts.relevantData
          .map((d) => `- [${d.source}/${d.sourceType}] **${d.title}**: ${d.summary.slice(0, 500)}`)
          .join('\n'),
      );

      // Sufficiency hint
      parts.push('\n\n> 以上是自动检索到的相关数据。如果不够，用 search_data 补充查询。');
    }

    if (parts.length === 0) return null;
    return parts.join('\n\n');
  }
}
