/**
 * agent/tools/web_fetch.ts — Phase 2.6: Web Fetch Tool (P1)
 *
 * URL → Markdown/Text 内容提取。
 * SSRF 防护（阻止内网地址）。
 * 50K chars 上限，15 分钟缓存。
 */
import type { Tool, ToolContext } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:web_fetch');

// ─── 缓存 ───

const CACHE_TTL = 15 * 60 * 1000;
const MAX_CONTENT_LENGTH = 50_000; // chars
const fetchCache = new Map<string, { content: string; ts: number }>();

function getCached(url: string): string | undefined {
  const entry = fetchCache.get(url);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > CACHE_TTL) {
    fetchCache.delete(url);
    return undefined;
  }
  return entry.content;
}

function setCache(url: string, content: string): void {
  if (fetchCache.size > 100) {
    const oldest = Array.from(fetchCache.entries()).sort((a, b) => a[1].ts - b[1].ts).slice(0, 30);
    for (const [k] of oldest) fetchCache.delete(k);
  }
  fetchCache.set(url, { content, ts: Date.now() });
}

// ─── SSRF 防护 ───

const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '[::1]',
  'metadata.google.internal',
  '169.254.169.254', // AWS/GCP metadata
]);

const BLOCKED_PREFIXES = [
  '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.',
  '172.25.', '172.26.', '172.27.', '172.28.', '172.29.',
  '172.30.', '172.31.', '192.168.',
];

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();

    // 阻止非 http/https 协议
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return true;
    }

    // 阻止内网主机
    if (BLOCKED_HOSTS.has(hostname)) return true;

    // 阻止内网 IP 段
    for (const prefix of BLOCKED_PREFIXES) {
      if (hostname.startsWith(prefix)) return true;
    }

    // 阻止 .local/.internal 域名
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true;

    return false;
  } catch {
    return true; // 无法解析的 URL 一律阻止
  }
}

// ─── HTML → Markdown 简单转换 ───

function htmlToText(html: string): string {
  // 移除 script 和 style
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');

  // 基本 HTML → Markdown 转换
  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n');
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n');
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n');
  text = text.replace(/<h[456][^>]*>([\s\S]*?)<\/h[456]>/gi, '\n#### $1\n');
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');
  text = text.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*');
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, '`$1`');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, '\n> $1\n');

  // 移除剩余标签
  text = text.replace(/<[^>]+>/g, '');

  // HTML 实体
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  // 清理多余空行
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// ─── Tool ───

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description:
    'Fetch and extract text content from a URL. Returns the page content as cleaned text/markdown. Useful for reading articles, documentation, or any web page. SSRF-protected: internal/private network URLs are blocked.',
  input_schema: {
    type: 'object',
    properties: {
      url: {
        type: 'string',
        description: 'The URL to fetch (must be http or https)',
      },
      format: {
        type: 'string',
        enum: ['text', 'markdown', 'raw'],
        description: 'Output format: "text" (cleaned text), "markdown" (basic html-to-markdown), "raw" (raw response body). Default: "markdown"',
      },
      max_length: {
        type: 'number',
        description: `Maximum content length in characters (default: ${MAX_CONTENT_LENGTH})`,
      },
    },
    required: ['url'],
  },

  async execute(input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    const url = input['url'] as string;
    const format = (input['format'] as string | undefined) ?? 'markdown';
    const maxLength = Math.min(
      (input['max_length'] as number | undefined) ?? MAX_CONTENT_LENGTH,
      MAX_CONTENT_LENGTH,
    );

    if (!url) return 'Error: url is required.';

    // SSRF 检查
    if (isBlockedUrl(url)) {
      return 'Error: This URL points to a private/internal network address and is blocked for security reasons.';
    }

    // 缓存检查（key 包含 format + maxLength，避免不同截断长度命中同一缓存）
    const cacheKey = `${url}:${format}:${maxLength}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);

      const res = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AgentFetch/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7',
        },
        redirect: 'follow',
      });

      clearTimeout(timeout);

      if (!res.ok) {
        return `Error: HTTP ${res.status} ${res.statusText} fetching ${url}`;
      }

      const contentType = res.headers.get('content-type') ?? '';
      const body = await res.text();

      let content: string;

      if (format === 'raw') {
        content = body;
      } else if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        content = htmlToText(body);
      } else {
        // JSON, plain text, etc.
        content = body;
      }

      // 截断
      if (content.length > maxLength) {
        content = content.slice(0, maxLength) + `\n\n[Content truncated at ${maxLength} characters]`;
      }

      const result = `## Fetched: ${url}\nContent-Type: ${contentType}\nLength: ${content.length} chars\n${'─'.repeat(60)}\n\n${content}`;

      setCache(cacheKey, result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      if (msg.includes('aborted') || msg.includes('abort')) {
        return `Error: Request timed out after 30 seconds for ${url}`;
      }

      log.error(`web_fetch error: ${url}`, err);
      return `Error fetching URL: ${msg}`;
    }
  },
};
