import Database from 'better-sqlite3';
import { createId } from '@jowork/core';
import { logInfo, logError } from '../utils/logger.js';

/**
 * CompactionProvider interface — pluggable summarization backend.
 * Default: rule-based. Future: Anthropic API, OpenAI, local model.
 */
export interface CompactionProvider {
  summarize(texts: string[], context?: string): Promise<string>;
}

/**
 * Rule-based compaction: extracts key sentences, deduplicates, truncates.
 * No LLM cost. Good enough for Phase 5 launch.
 */
export class RuleBasedCompaction implements CompactionProvider {
  async summarize(texts: string[], _context?: string): Promise<string> {
    // Extract first meaningful sentence from each text
    const sentences: string[] = [];
    for (const text of texts) {
      // Strip JSON/HTML markup
      const clean = text
        .replace(/\[\[?\{[^}]+\}[\]}\]]*,?/g, '') // strip JSON tags
        .replace(/<[^>]+>/g, '') // strip HTML
        .replace(/https?:\/\/\S+/g, '[link]') // collapse URLs
        .trim();
      if (clean.length < 5) continue;
      // Take first 100 chars as representative sentence
      const sentence = clean.length > 100 ? clean.slice(0, 100) + '...' : clean;
      if (!sentences.includes(sentence)) {
        sentences.push(sentence);
      }
    }
    // Cap at 20 sentences
    return sentences.slice(0, 20).join('\n');
  }
}

/**
 * LLM-powered compaction using Anthropic Claude API.
 * Requires ANTHROPIC_API_KEY in environment or credentials.
 */
export class AnthropicCompaction implements CompactionProvider {
  private apiKey: string;
  private model: string;

  constructor(apiKey?: string, model: string = 'claude-sonnet-4-20250514') {
    this.apiKey = apiKey ?? process.env['ANTHROPIC_API_KEY'] ?? '';
    this.model = model;
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY required for LLM compaction. Set env var or use RuleBasedCompaction instead.');
    }
  }

  async summarize(texts: string[], context?: string): Promise<string> {
    const combined = texts.slice(0, 50).join('\n---\n'); // Cap input
    const truncated = combined.length > 10000 ? combined.slice(0, 10000) + '\n...(truncated)' : combined;

    const systemPrompt = context
      ? `Summarize the following data concisely. Context: ${context}. Output in the same language as the input. Be factual, no opinions.`
      : `Summarize the following data into a concise briefing. Highlight key decisions, action items, and notable events. Output in the same language as the input. Be factual, focus on what matters.`;

    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          messages: [{ role: 'user', content: truncated }],
          system: systemPrompt,
        }),
      });

      if (!res.ok) {
        logError('compaction', `Anthropic API error: ${res.status}`);
        // Fallback to rule-based
        return new RuleBasedCompaction().summarize(texts, context);
      }

      const data = await res.json() as { content: Array<{ type: string; text: string }> };
      return data.content?.[0]?.text ?? '';
    } catch (err) {
      logError('compaction', `LLM compaction failed, falling back to rule-based`, { error: String(err) });
      return new RuleBasedCompaction().summarize(texts, context);
    }
  }
}

export interface CompactionResult {
  hotEntries: number;
  warmEntries: number;
}

/**
 * Run compaction: generate L1 (hot 24-72h) and L2 (warm, per-goal weekly) summaries.
 */
export async function runCompaction(
  sqlite: Database.Database,
  provider?: CompactionProvider,
): Promise<CompactionResult> {
  // Auto-detect provider: use LLM if API key available, else rule-based
  if (!provider) {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    try {
      provider = apiKey
        ? new AnthropicCompaction(apiKey)
        : new RuleBasedCompaction();
    } catch {
      provider = new RuleBasedCompaction();
    }
  }
  let hotEntries = 0;
  let warmEntries = 0;

  // ── L1 Hot: Summarize last 24-72 hours of data ──
  const now = Date.now();
  const windows = [
    { label: '24h', start: now - 24 * 60 * 60 * 1000, end: now },
    { label: '48h', start: now - 48 * 60 * 60 * 1000, end: now - 24 * 60 * 60 * 1000 },
    { label: '72h', start: now - 72 * 60 * 60 * 1000, end: now - 48 * 60 * 60 * 1000 },
  ];

  for (const window of windows) {
    // Check if we already have a hot summary for this window
    const existing = sqlite.prepare(
      `SELECT id FROM memory_hot WHERE window_start = ? AND window_end = ?`
    ).get(window.start, window.end);
    if (existing) continue;

    // Get objects in this window
    const objects = sqlite.prepare(`
      SELECT ob.content FROM objects o
      JOIN object_bodies ob ON ob.object_id = o.id
      WHERE o.created_at >= ? AND o.created_at < ?
      ORDER BY o.created_at DESC
      LIMIT 100
    `).all(window.start, window.end) as Array<{ content: string }>;

    if (objects.length === 0) continue;

    const summary = await provider.summarize(objects.map(o => o.content));
    const id = createId('hot');
    sqlite.prepare(`
      INSERT INTO memory_hot (id, window_start, window_end, summary, source_count, sources, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, window.start, window.end, summary, objects.length, null, now);
    hotEntries++;
  }

  // ── L2 Warm: Summarize per-goal weekly trends ──
  const goals = sqlite.prepare(
    `SELECT id, title FROM goals WHERE status = 'active'`
  ).all() as Array<{ id: string; title: string }>;

  const weekStart = now - 7 * 24 * 60 * 60 * 1000;

  for (const goal of goals) {
    // Check if warm summary exists for this goal+period
    const existing = sqlite.prepare(
      `SELECT id FROM memory_warm WHERE goal_id = ? AND period_start >= ?`
    ).get(goal.id, weekStart);
    if (existing) continue;

    // Get signal history for this goal
    const signals = sqlite.prepare(`
      SELECT s.title, s.current_value, s.direction, m.threshold, m.comparison, m.met
      FROM signals s
      LEFT JOIN measures m ON m.signal_id = s.id
      WHERE s.goal_id = ?
    `).all(goal.id) as Array<{
      title: string; current_value: number | null; direction: string;
      threshold: number | null; comparison: string | null; met: number | null;
    }>;

    if (signals.length === 0) continue;

    // Build trend summary
    const parts: string[] = [`Goal: ${goal.title}`];
    for (const sig of signals) {
      const status = sig.met === 1 ? '✓ MET' : sig.met === 0 ? '✗ NOT MET' : 'N/A';
      parts.push(`  Signal: ${sig.title} = ${sig.current_value ?? 'no data'} (${sig.direction}, target: ${sig.comparison ?? ''} ${sig.threshold ?? ''}) [${status}]`);
    }

    const id = createId('warm');
    sqlite.prepare(`
      INSERT INTO memory_warm (id, goal_id, period_start, period_end, summary, key_decisions, trends, source_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, goal.id, weekStart, now, parts.join('\n'), null, null, signals.length, now);
    warmEntries++;
  }

  if (hotEntries > 0 || warmEntries > 0) {
    logInfo('compaction', `Generated ${hotEntries} hot + ${warmEntries} warm summaries`);
  }

  return { hotEntries, warmEntries };
}
