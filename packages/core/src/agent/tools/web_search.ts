/**
 * agent/tools/web_search.ts — Phase 2.5: Web Search Tool (P1)
 *
 * 多 provider 支持（Brave Search 首选）。
 * 15 分钟内存缓存。
 */
import type { Tool, ToolContext, StructuredResult, StructuredListItem } from '../types.js';
import { config as gatewayConfig } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:web_search');

// ─── 缓存 ───

interface CacheEntry {
  result: string;
  structured: StructuredResult;
  ts: number;
}

const CACHE_TTL = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, CacheEntry>();

function getCached(key: string): CacheEntry | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    cache.delete(key);
    return undefined;
  }
  return entry;
}

function setCache(key: string, result: string, structured: StructuredResult): void {
  // 限制缓存条目数
  if (cache.size > 200) {
    const oldest = Array.from(cache.entries()).sort((a, b) => a[1].ts - b[1].ts).slice(0, 50);
    for (const [k] of oldest) cache.delete(k);
  }
  cache.set(key, { result, structured, ts: Date.now() });
}

// ─── Brave Search Provider ───

interface BraveResult {
  title: string;
  url: string;
  description: string;
}

async function braveSearch(query: string, count: number): Promise<BraveResult[]> {
  const apiKey = gatewayConfig.braveSearchApiKey;
  if (!apiKey) {
    throw new Error('BRAVE_SEARCH_API_KEY not configured');
  }

  const params = new URLSearchParams({
    q: query,
    count: String(Math.min(count, 20)),
    text_decorations: 'false',
  });

  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: {
      'Accept': 'application/json',
      'Accept-Encoding': 'gzip',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Brave Search API error ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json() as { web?: { results?: Array<{ title: string; url: string; description: string }> } };
  const results = data.web?.results ?? [];

  return results.map(r => ({
    title: r.title,
    url: r.url,
    description: r.description,
  }));
}

// ─── Tool ───

export const webSearchTool: Tool = {
  name: 'web_search',
  description:
    'Search the web for current information. Returns structured search results with titles, URLs, and descriptions. Use this when you need up-to-date information that may not be in your training data.',
  input_schema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query',
      },
      count: {
        type: 'number',
        description: 'Number of results to return (1-10, default: 5)',
      },
    },
    required: ['query'],
  },

  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const query = input['query'] as string;
    const count = Math.min(Math.max(1, (input['count'] as number | undefined) ?? 5), 10);

    if (!query || query.trim().length === 0) {
      return 'Error: search query is required.';
    }

    // 检查缓存
    const cacheKey = `search:${query}:${count}`;
    const cached = getCached(cacheKey);
    if (cached) return cached.result;

    try {
      const results = await braveSearch(query, count);
      const { text, structured } = formatResults(query, results);
      setCache(cacheKey, text, structured);
      return text;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // 如果 Brave Search 不可用，返回有用的错误信息
      if (msg.includes('not configured')) {
        return 'Web search is not available: BRAVE_SEARCH_API_KEY is not configured. Ask an admin to set it up.';
      }

      log.error(`web_search error: ${query}`, err);
      return `Search failed: ${msg}`;
    }
  },

  async executeStructured(input: Record<string, unknown>, ctx: ToolContext): Promise<{ text: string; structured: StructuredResult }> {
    const query = input['query'] as string;
    const count = Math.min(Math.max(1, (input['count'] as number | undefined) ?? 5), 10);

    if (!query || query.trim().length === 0) {
      return { text: 'Error: search query is required.', structured: { type: 'text' } };
    }

    const cacheKey = `search:${query}:${count}`;
    const cached = getCached(cacheKey);
    if (cached) return { text: cached.result, structured: cached.structured };

    try {
      const results = await braveSearch(query, count);
      const { text, structured } = formatResults(query, results);
      setCache(cacheKey, text, structured);
      return { text, structured };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`web_search error: ${query}`, err);
      return { text: `Search failed: ${msg}`, structured: { type: 'text' } };
    }
  },
};

function formatResults(query: string, results: BraveResult[]): { text: string; structured: StructuredResult } {
  if (results.length === 0) {
    return {
      text: `No results found for "${query}".`,
      structured: { type: 'list', items: [], total: 0 },
    };
  }

  const lines = [`## Search Results for "${query}"`, `${results.length} results found`, ''];
  const items: StructuredListItem[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    lines.push(`### ${i + 1}. ${r.title}`);
    lines.push(`URL: ${r.url}`);
    lines.push(r.description);
    lines.push('');

    items.push({
      title: r.title,
      description: r.description,
      uri: r.url,
    });
  }

  return {
    text: lines.join('\n'),
    structured: { type: 'list', items, total: results.length },
  };
}
