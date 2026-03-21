import Database from 'better-sqlite3';
import { logInfo } from '../utils/logger.js';

interface ExtractedLink {
  linkType: string;
  identifier: string;
  confidence: 'high' | 'medium' | 'low';
  metadata?: Record<string, unknown>;
}

// Regex patterns for identifier extraction
const PATTERNS: Array<{ type: string; regex: RegExp; confidence: 'high' | 'medium' | 'low' }> = [
  // GitHub/GitLab PR/Issue references
  { type: 'pr', regex: /(?:PR|pr|Pull Request|pull request)\s*#?(\d+)/g, confidence: 'high' },
  { type: 'issue', regex: /(?:issue|Issue|ISSUE)\s*#?(\d+)/g, confidence: 'high' },
  { type: 'issue', regex: /#(\d{2,6})\b/g, confidence: 'medium' }, // bare #123

  // Linear-style issue keys (e.g. LIN-234, PROJ-56)
  // Requires 2+ digit number to reduce false positives (GPT-5, GLP-1 are NOT issues)
  { type: 'issue', regex: /\b([A-Z]{2,10}-\d{2,6})\b/g, confidence: 'high' },

  // Git commit SHA
  { type: 'commit', regex: /\b([0-9a-f]{7,40})\b/g, confidence: 'low' },

  // URLs
  { type: 'url', regex: /https?:\/\/[^\s<>"{}|\\^`\[\]]+/g, confidence: 'high' },

  // @mentions (feishu user_id format)
  { type: 'mention', regex: /@([a-zA-Z0-9_]+)/g, confidence: 'medium' },
];

export function extractLinks(content: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (const pattern of PATTERNS) {
    // Skip commit SHA pattern for short content (too many false positives)
    if (pattern.type === 'commit' && content.length < 100) continue;

    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const identifier = match[1] ?? match[0];
      const key = `${pattern.type}:${identifier}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip very short identifiers (likely false positives) — except for PR numbers (have explicit PR prefix)
      if (identifier.length < 3 && pattern.type !== 'pr') continue;
      // Skip commit SHAs that look like hex numbers less than 7 chars
      if (pattern.type === 'commit' && identifier.length < 7) continue;

      links.push({
        linkType: pattern.type,
        identifier,
        confidence: pattern.confidence,
      });
    }
  }

  return links;
}

export function processObjectLinks(sqlite: Database.Database, objectId: string, content: string): number {
  const links = extractLinks(content);
  if (links.length === 0) return 0;

  const insert = sqlite.prepare(`
    INSERT OR IGNORE INTO object_links (id, source_object_id, target_object_id, link_type, identifier, metadata, confidence, created_at)
    VALUES (?, ?, NULL, ?, ?, ?, ?, ?)
  `);

  const now = Date.now();
  let count = 0;

  const batch = sqlite.transaction(() => {
    for (const link of links) {
      // Generate a deterministic ID to enable INSERT OR IGNORE dedup
      const id = `${objectId}:${link.linkType}:${link.identifier}`.slice(0, 64);
      insert.run(
        id,
        objectId,
        link.linkType,
        link.identifier,
        link.metadata ? JSON.stringify(link.metadata) : null,
        link.confidence,
        now,
      );
      count++;
    }
  });

  batch();
  return count;
}

/**
 * Run entity extraction on all objects not yet processed.
 * Uses `links_processed` flag to avoid re-processing objects with no extractable identifiers.
 */
export function linkAllUnprocessed(sqlite: Database.Database): { processed: number; linksCreated: number } {
  const unprocessed = sqlite.prepare(`
    SELECT o.id, ob.content FROM objects o
    JOIN object_bodies ob ON ob.object_id = o.id
    WHERE o.links_processed = 0
    LIMIT 1000
  `).all() as Array<{ id: string; content: string }>;

  if (unprocessed.length === 0) return { processed: 0, linksCreated: 0 };

  let linksCreated = 0;
  const markProcessed = sqlite.prepare('UPDATE objects SET links_processed = 1 WHERE id = ?');

  const batch = sqlite.transaction(() => {
    for (const obj of unprocessed) {
      linksCreated += processObjectLinks(sqlite, obj.id, obj.content);
      markProcessed.run(obj.id);
    }
  });
  batch();

  logInfo('linker', `Processed ${unprocessed.length} objects, created ${linksCreated} links`);
  return { processed: unprocessed.length, linksCreated };
}
