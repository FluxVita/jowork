import type { ContextDoc } from './docs';
import type { MemoryRecord } from '../memory/store';

interface AssembleOpts {
  teamDocs: ContextDoc[];
  personalDocs: ContextDoc[];
  memories: MemoryRecord[];
  workstyle: string;
  tokenBudget: number;
}

// Rough estimate: 1 token ~= 4 chars for English, ~2 chars for CJK
function estimateTokens(text: string): number {
  const cjkChars = (text.match(/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/g) || []).length;
  const otherChars = text.length - cjkChars;
  return Math.ceil(cjkChars / 2 + otherChars / 4);
}

/**
 * Assembles context from multiple sources within a token budget.
 * Priority: workstyle > pinned memories > team docs > personal docs > recent memories
 */
export class ContextAssembler {
  assemble(opts: AssembleOpts): string {
    const sections: { label: string; content: string; priority: number }[] = [];
    let usedTokens = 0;

    // 1. Workstyle (highest priority)
    if (opts.workstyle) {
      sections.push({ label: 'Work Style', content: opts.workstyle, priority: 100 });
    }

    // 2. Pinned memories
    const pinned = opts.memories.filter((m) => m.pinned);
    if (pinned.length > 0) {
      const content = pinned.map((m) => `- **${m.title}**: ${m.content}`).join('\n');
      sections.push({ label: 'Pinned Memories', content, priority: 90 });
    }

    // 3. Team docs (by priority)
    for (const doc of opts.teamDocs.sort((a, b) => b.priority - a.priority)) {
      sections.push({ label: `Team: ${doc.title}`, content: doc.content, priority: 70 + (doc.priority / 10) });
    }

    // 4. Personal docs
    for (const doc of opts.personalDocs.sort((a, b) => b.priority - a.priority)) {
      sections.push({ label: `Personal: ${doc.title}`, content: doc.content, priority: 50 + (doc.priority / 10) });
    }

    // 5. Recent memories (not pinned)
    const recent = opts.memories.filter((m) => !m.pinned).slice(0, 10);
    if (recent.length > 0) {
      const content = recent.map((m) => `- ${m.title}: ${m.content}`).join('\n');
      sections.push({ label: 'Recent Memories', content, priority: 30 });
    }

    // Assemble within budget, highest priority first
    sections.sort((a, b) => b.priority - a.priority);

    const result: string[] = [];
    for (const section of sections) {
      const sectionText = `## ${section.label}\n\n${section.content}\n`;
      const tokens = estimateTokens(sectionText);
      if (usedTokens + tokens > opts.tokenBudget) {
        // Try to fit a truncated version
        const remaining = opts.tokenBudget - usedTokens;
        if (remaining > 50) {
          const truncated = section.content.slice(0, remaining * 3); // rough char limit
          result.push(`## ${section.label}\n\n${truncated}...\n`);
        }
        break;
      }
      result.push(sectionText);
      usedTokens += tokens;
    }

    return result.join('\n');
  }
}
