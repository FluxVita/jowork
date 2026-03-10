/**
 * agent/tools/fs_write.ts — Phase 2.2: File System Write Tool (P1)
 *
 * Agent 可在 workspace 内创建/写入文件。
 * 安全：所有路径必须在 data/workspaces/{session_id}/ 内。
 */
import { writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { resolve, dirname, normalize } from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:fs_write');

/** 获取 workspace 根目录 */
function getWorkspaceRoot(sessionId: string): string {
  return resolve(process.cwd(), 'data', 'workspaces', sessionId);
}

/** 规范化并验证路径安全 */
function safePath(sessionId: string, filePath: string): { valid: boolean; resolved: string; error?: string } {
  const root = getWorkspaceRoot(sessionId);
  const normalized = normalize(filePath);

  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    return { valid: false, resolved: '', error: 'Absolute paths are not allowed. Use relative paths within your workspace.' };
  }

  const resolved = resolve(root, normalized);

  if (!resolved.startsWith(root)) {
    return { valid: false, resolved: '', error: 'Path traversal detected. Stay within your workspace directory.' };
  }

  return { valid: true, resolved };
}

/** 写入文件大小限制 */
const MAX_WRITE_SIZE = 2 * 1024 * 1024; // 2MB

export const fsWriteTool: Tool = {
  name: 'fs_write',
  description:
    'Write or create a file in your workspace. Provide a relative path and the content to write. Parent directories are created automatically. Use this for creating new files or completely replacing file content. For partial edits, prefer fs_edit.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative file path within your workspace (e.g. "output/result.json")',
      },
      content: {
        type: 'string',
        description: 'File content to write',
      },
      append: {
        type: 'boolean',
        description: 'If true, append to existing file instead of overwriting (default: false)',
      },
    },
    required: ['path', 'content'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = input['path'] as string;
    const content = input['content'] as string;
    const append = input['append'] as boolean | undefined;

    if (!filePath) return 'Error: path is required.';
    if (content === undefined || content === null) return 'Error: content is required.';

    // 大小限制
    const byteSize = Buffer.byteLength(content, 'utf-8');
    if (byteSize > MAX_WRITE_SIZE) {
      return `Error: Content too large (${(byteSize / 1024 / 1024).toFixed(1)}MB). Maximum: ${MAX_WRITE_SIZE / 1024 / 1024}MB.`;
    }

    const check = safePath(ctx.session_id, filePath);
    if (!check.valid) return `Error: ${check.error}`;

    try {
      // 确保目录存在
      const dir = dirname(check.resolved);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const existed = existsSync(check.resolved);

      if (append && existed) {
        const { appendFileSync } = await import('node:fs');
        appendFileSync(check.resolved, content, 'utf-8');
        const stat = statSync(check.resolved);
        return `Appended ${byteSize} bytes to ${filePath} (total: ${stat.size} bytes)`;
      }

      writeFileSync(check.resolved, content, 'utf-8');
      const lineCount = content.split('\n').length;

      if (existed) {
        return `File overwritten: ${filePath} (${lineCount} lines, ${byteSize} bytes)`;
      }
      return `File created: ${filePath} (${lineCount} lines, ${byteSize} bytes)`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`fs_write error: ${filePath}`, err);
      return `Error writing file: ${msg}`;
    }
  },
};
