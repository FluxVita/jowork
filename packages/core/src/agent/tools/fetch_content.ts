import type { Tool, ToolContext, StructuredResult } from '../types.js';
import { getObjectByUri, upsertObject } from '../../datamap/objects.js';
import { readContentRange, saveContent } from '../../datamap/content-store.js';
import { getConnectorBySource } from '../../connectors/registry.js';
import { checkAccess } from '../../policy/engine.js';
import { getUserById } from '../../auth/users.js';
import { FeishuConnector } from '../../connectors/feishu/index.js';

const DEFAULT_LIMIT = 30000;

export const fetchContentTool: Tool = {
  name: 'fetch_content',
  description: '拉取数据对象的完整内容。支持 search_data 返回的 URI，也支持飞书文档 URL。超大文档可用 offset/limit 分段读取。默认读本地缓存（会标注同步时间），用户要求"最新版/实时/当前版本"时传 fresh=true 强制拉最新。',
  input_schema: {
    type: 'object',
    properties: {
      uri: { type: 'string', description: '数据对象的 URI（从 search_data 结果中获取），或飞书文档 URL' },
      offset: { type: 'number', description: '字符偏移量，默认 0。用于分段读取超大文档' },
      limit: { type: 'number', description: '读取字符数上限，默认 30000' },
      fresh: { type: 'boolean', description: '是否强制拉取最新版本（跳过本地缓存）。当用户说"最新"/"实时"/"当前版本"时传 true' },
    },
    required: ['uri'],
  },

  async executeStructured(input: Record<string, unknown>, ctx: ToolContext): Promise<{ text: string; structured: StructuredResult }> {
    const text = await fetchContentTool.execute(input, ctx);
    const uri = input['uri'] as string;
    const fresh = input['fresh'] === true;

    // 如果有本地文件路径且不是 fresh 模式，额外提供 file 类型供前端下载
    if (uri && !fresh && !uri.includes('feishu.cn/') && !uri.includes('larksuite.com/')) {
      const obj = getObjectByUri(uri);
      if (obj?.content_path) {
        const { statSync } = await import('node:fs');
        try {
          const stat = statSync(obj.content_path);
          const fileName = `${obj.title.replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_')}.md`;
          return {
            text,
            structured: { type: 'file', file_path: obj.content_path, file_name: fileName, total: stat.size },
          };
        } catch { /* 文件不存在，降级为 markdown */ }
      }
    }

    return {
      text,
      structured: { type: 'markdown', content: text },
    };
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const uri = input['uri'] as string;
    if (!uri) return 'ERROR: 缺少 uri 参数';

    const offset = (input['offset'] as number) || 0;
    const limit = (input['limit'] as number) || DEFAULT_LIMIT;
    const fresh = input['fresh'] === true;

    const user = getUserById(ctx.user_id);
    if (!user) return 'ERROR: 用户不存在';

    // ── 飞书 URL 直接拉取分支 ──
    if (uri.includes('feishu.cn/') || uri.includes('larksuite.com/')) {
      // 权限校验：如果文档已注册为 object，走 checkAccess
      const existingObj = getObjectByUri(uri);
      if (existingObj) {
        const access = checkAccess(user, existingObj, 'read');
        if (!access.allowed) return 'ERROR: 无权访问此飞书文档';
      }
      // 未注册的文档（首次拉取），飞书 API 本身会校验 token 权限，暂时放行

      try {
        const feishu = new FeishuConnector();
        const result = await feishu.fetchByUrl(uri);
        return formatWithRange(result.content, `[飞书] ${result.title}`, 'API拉取', offset, limit);
      } catch (err) {
        return `ERROR: 拉取飞书文档失败 — ${String(err)}`;
      }
    }

    const obj = getObjectByUri(uri);
    if (!obj) return `ERROR: 未找到 URI 为 "${uri}" 的数据对象`;

    // 权限检查
    const access = checkAccess(user, obj, 'read');
    if (!access.allowed) return 'ERROR: 无权访问此数据对象';

    // fresh=true → 跳过本地缓存，强制走 Connector API
    if (!fresh && obj.content_path) {
      const rangeResult = readContentRange(obj.content_path, offset, limit);
      if (rangeResult) {
        const timeAgo = formatTimeAgo(obj.last_indexed_at);
        const label = `[${obj.source}] ${obj.title}`;
        const storageType = `本地全文, 同步于 ${timeAgo}`;
        return formatRangeResult(rangeResult.content, rangeResult.totalLength, rangeResult.hasMore, label, storageType, offset, limit);
      }
    }

    // 通过 Connector API 拉取（fresh 模式或无本地缓存）
    const connector = getConnectorBySource(obj.source);
    if (!connector) return `ERROR: 数据源 ${obj.source} 的连接器不可用`;

    try {
      const fetched = await connector.fetch(uri, { user_id: ctx.user_id, role: ctx.role });

      // fresh 模式：拉取后更新本地缓存
      if (fresh && fetched.content) {
        const contentPath = saveContent(obj.source, obj.object_id, fetched.content);
        upsertObject({
          ...obj,
          content_path: contentPath,
          content_length: fetched.content.length,
        });
      }

      const storageType = fresh ? 'API拉取(最新版)' : 'API拉取';
      return formatWithRange(fetched.content, `[${obj.source}] ${obj.title}`, storageType, offset, limit);
    } catch (err) {
      return `ERROR: 拉取内容失败 — ${String(err)}`;
    }
  },
};

/** 计算相对时间描述 */
function formatTimeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (isNaN(diffMs) || diffMs < 0) return '刚刚';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/** 对 API/飞书拉取的完整内容应用 offset/limit 分段 */
function formatWithRange(fullContent: string, label: string, storageType: string, offset: number, limit: number): string {
  const totalLength = fullContent.length;
  const content = fullContent.slice(offset, offset + limit);
  const hasMore = offset + limit < totalLength;
  return formatRangeResult(content, totalLength, hasMore, label, storageType, offset, limit);
}

/** 统一格式化分段读取结果 */
function formatRangeResult(
  content: string, totalLength: number, hasMore: boolean,
  label: string, storageType: string, offset: number, limit: number,
): string {
  const endPos = Math.min(offset + limit, totalLength);
  const parts: string[] = [];

  parts.push(`${label} (${storageType}, ${totalLength} 字符)`);

  if (offset > 0 || hasMore) {
    parts.push(`[读取范围: 字符 ${offset}-${endPos}]`);
  }

  parts.push('');
  parts.push(content);

  if (hasMore) {
    const remaining = totalLength - endPos;
    parts.push(`\n...(还有 ${remaining} 字符未读取，可用 offset=${endPos} 继续)`);
  }

  return parts.join('\n');
}
