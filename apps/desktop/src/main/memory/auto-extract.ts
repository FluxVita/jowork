import type { MemoryStore, NewMemory } from './store';
import type { Message } from '@jowork/core';

/**
 * Auto-extract potential memories from conversation messages.
 * Uses simple heuristic pattern matching for Phase 3.
 * Phase 4+ can use the AI engine itself for extraction.
 */
export class AutoExtractor {
  constructor(private memoryStore: MemoryStore) {}

  /**
   * Analyze a completed conversation and extract potential memories.
   * Returns the created memory IDs.
   */
  extractFromConversation(messages: Message[]): string[] {
    const createdIds: string[] = [];

    // Filter to user messages that might contain preferences/decisions
    const userMessages = messages.filter((m) => m.role === 'user');

    for (const msg of userMessages) {
      const extracted = this.detectPatterns(msg.content);
      for (const mem of extracted) {
        const created = this.memoryStore.create({
          ...mem,
          source: 'auto',
        });
        createdIds.push(created.id);
      }
    }

    return createdIds;
  }

  private detectPatterns(content: string): NewMemory[] {
    const results: NewMemory[] = [];

    // Pattern: "I prefer X" / "I always X" / "I like X"
    const preferencePatterns = [
      /(?:i\s+(?:prefer|always|like|want|need)\s+)(.{10,100})/gi,
      /(?:please\s+(?:always|never)\s+)(.{10,100})/gi,
      /(?:remember\s+(?:that|to)\s+)(.{10,100})/gi,
    ];

    for (const pattern of preferencePatterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        results.push({
          title: match[1].slice(0, 60).trim(),
          content: match[0].trim(),
          tags: ['auto-extracted', 'preference'],
          scope: 'personal',
        });
      }
    }

    return results;
  }
}
