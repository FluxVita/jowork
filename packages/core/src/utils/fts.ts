/**
 * FTS5 CJK helpers — shared across desktop and cloud.
 *
 * SQLite FTS5's unicode61 tokenizer has two known CJK limitations:
 * 1. No token split at CJK↔Latin boundaries without whitespace
 * 2. CJK multi-char words (e.g. "上下文") are split into single chars, so MATCH fails
 *
 * These utilities provide a consistent workaround across all indexing and search code.
 */

/** Unicode ranges treated as CJK for tokenization purposes. */
const CJK_RANGES = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\uf900-\\ufaff\\u3000-\\u303f\\uff00-\\uffef';

/** Matches any single CJK character. */
export const CJK_RE = new RegExp(`[${CJK_RANGES}]`);

/** CJK followed by Latin (no space between). */
const CJK_THEN_LATIN = new RegExp(`([${CJK_RANGES}])([a-zA-Z0-9])`, 'g');
/** Latin followed by CJK (no space between). */
const LATIN_THEN_CJK = new RegExp(`([a-zA-Z0-9])([${CJK_RANGES}])`, 'g');

/**
 * Normalize text for FTS5 indexing.
 * Inserts spaces at CJK↔Latin boundaries so unicode61 tokenizer can split them.
 * Must be used consistently: both at index time and (if needed) at query time.
 */
export function ftsNormalize(text: string): string {
  return text
    .replace(CJK_THEN_LATIN, '$1 $2')
    .replace(LATIN_THEN_CJK, '$1 $2');
}

/**
 * Build FTS5 MATCH query from user input.
 * Returns null if the query is primarily CJK — caller should fall through to LIKE.
 */
export function buildFtsQuery(input: string): string | null {
  const parts = input
    .split(/[\s,.:;!?()[\]{}<>'"、。，！？（）【】《》""''·\-/\\|]+/)
    .filter(Boolean);

  const latinTokens: string[] = [];
  let hasCjk = false;

  for (const part of parts) {
    if (CJK_RE.test(part)) {
      hasCjk = true;
      // Extract embedded Latin words from mixed CJK+Latin text
      const latinParts = part.split(new RegExp(`[${CJK_RANGES}]+`)).filter((p) => p.length >= 2);
      latinTokens.push(...latinParts);
    } else if (part.length >= 2) {
      latinTokens.push(part.replace(/['"(){}*:^~\-+[\]]/g, ''));
    }
  }

  // Primarily CJK with no meaningful Latin tokens → skip FTS, use LIKE
  if (hasCjk && latinTokens.length === 0) return null;
  if (latinTokens.length === 0) return null;
  return latinTokens.join(' OR ');
}

/**
 * Detect if query mentions a specific data source name.
 * Returns the source identifier for filtering, or null.
 */
/**
 * Detect if query mentions a specific data source name.
 * Returns the source identifier for filtering, or null.
 */
export function detectSourceFromQuery(query: string): string | null {
  const lower = query.toLowerCase();
  if (/飞书|feishu|lark/.test(lower)) return 'feishu';
  if (/\bgithub\b/.test(lower)) return 'github';
  if (/\bgitlab\b/.test(lower)) return 'gitlab';
  if (/\bnotion\b/.test(lower)) return 'notion';
  if (/\bslack\b/.test(lower)) return 'slack';
  return null;
}

/** Source aliases for FTS indexing — enriches the source column with CJK synonyms. */
const SOURCE_ALIASES: Record<string, string> = {
  feishu: 'feishu 飞书 lark',
  github: 'github',
  gitlab: 'gitlab',
  notion: 'notion',
  slack: 'slack',
  local: 'local 本地',
};

/**
 * Enrich a source identifier with aliases for FTS indexing.
 * E.g. "feishu" → "feishu 飞书 lark" so FTS MATCH "飞书" hits the source column.
 */
export function ftsEnrichSource(source: string): string {
  return SOURCE_ALIASES[source] ?? source;
}
