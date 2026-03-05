// Agent self-learning logic (Section 6.3)
// After each conversation turn, extract useful facts and update context_docs

import type { Database } from 'better-sqlite3';

export interface LearnedFact {
  title: string;
  content: string;
  source: 'conversation' | 'feedback' | 'correction';
}

/**
 * Extract learnable facts from a completed conversation turn.
 * Returns facts that should be persisted to context_docs for future context assembly.
 */
export function extractLearnedFacts(
  userMessage: string,
  assistantReply: string,
): LearnedFact[] {
  const facts: LearnedFact[] = [];

  // Detect user corrections (signals a previous misunderstanding)
  const correctionPatterns = [
    /no[,\s]+(?:actually|that'?s?\s+not)/i,
    /that'?s?\s+(?:wrong|incorrect)/i,
    /actually[,\s]+it'?s?/i,
    /please\s+(?:remember|note|keep\s+in\s+mind)/i,
  ];
  for (const pattern of correctionPatterns) {
    if (pattern.test(userMessage)) {
      facts.push({
        title: 'User correction',
        content: userMessage.slice(0, 500),
        source: 'correction',
      });
      break;
    }
  }

  // Detect explicit preferences or instructions
  const preferencePatterns = [
    /(?:always|never|prefer|use)\s+.{5,80}/i,
    /(?:my|our)\s+(?:team|company|project)\s+.{5,80}/i,
  ];
  for (const pattern of preferencePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      facts.push({
        title: 'User preference',
        content: match[0].slice(0, 500),
        source: 'feedback',
      });
      break;
    }
  }

  return facts;
}

/**
 * Persist learned facts to the context_docs table so they are available
 * in future context assembly (Section 6.2).
 */
export function persistLearnedFacts(db: Database, facts: LearnedFact[]): void {
  if (facts.length === 0) return;

  const insert = db.prepare(`
    INSERT INTO context_docs (title, content, source, created_at, updated_at)
    VALUES (?, ?, ?, strftime('%s','now'), strftime('%s','now'))
    ON CONFLICT DO NOTHING
  `);

  const run = db.transaction(() => {
    for (const fact of facts) {
      insert.run(fact.title, fact.content, fact.source);
    }
  });

  run();
}

/**
 * High-level hook: call after each completed agent turn to update learned context.
 */
export function learnFromTurn(
  db: Database,
  userMessage: string,
  assistantReply: string,
): void {
  const facts = extractLearnedFacts(userMessage, assistantReply);
  persistLearnedFacts(db, facts);
}
