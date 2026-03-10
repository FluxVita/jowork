/**
 * agent/tools/fs_read.ts — Phase 2.2: File System Read Tool (P1)
 *
 * Agent 可读取 workspace 内的文件。
 * 安全：所有路径必须在 data/workspaces/{session_id}/ 内，防目录穿越。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, relative, normalize } from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:fs_read');

/** 获取 workspace 根目录 */
function getWorkspaceRoot(sessionId: string): string {
  return resolve(process.cwd(), 'data', 'workspaces', sessionId);
}

/** 规范化并验证路径安全（防目录穿越） */
function safePath(sessionId: string, filePath: string): { valid: boolean; resolved: string; error?: string } {
  const root = getWorkspaceRoot(sessionId);
  const normalized = normalize(filePath);

  // 绝对路径直接拒绝
  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    return { valid: false, resolved: '', error: 'Absolute paths are not allowed. Use relative paths within your workspace.' };
  }

  const resolved = resolve(root, normalized);

  // 确保解析后的路径仍在 workspace 内
  if (!resolved.startsWith(root)) {
    return { valid: false, resolved: '', error: 'Path traversal detected. Stay within your workspace directory.' };
  }

  return { valid: true, resolved };
}

export const fsReadTool: Tool = {
  name: 'fs_read',
  description:
    'Read file contents from your workspace. Files are stored in a sandboxed workspace directory. Provide a relative path. You can also list directory contents by setting list_dir=true. Supports offset/limit for reading specific line ranges of large files.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative file path within your workspace (e.g. "notes.md", "src/index.ts")',
      },
      offset: {
        type: 'number',
        description: 'Start reading from this line number (1-based, default: 1)',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of lines to read (default: all)',
      },
      list_dir: {
        type: 'boolean',
        description: 'If true, list directory contents instead of reading a file',
      },
    },
    required: ['path'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = input['path'] as string;
    const offset = (input['offset'] as number | undefined) ?? 1;
    const limit = input['limit'] as number | undefined;
    const listDir = input['list_dir'] as boolean | undefined;

    if (!filePath) return 'Error: path is required.';

    const check = safePath(ctx.session_id, filePath);
    if (!check.valid) return `Error: ${check.error}`;

    try {
      if (listDir) {
        return listDirectory(check.resolved, ctx.session_id);
      }

      if (!existsSync(check.resolved)) {
        return `Error: File not found: ${filePath}`;
      }

      const stat = statSync(check.resolved);
      if (stat.isDirectory()) {
        return listDirectory(check.resolved, ctx.session_id);
      }

      // 检查文件大小（防止读取巨大文件）
      if (stat.size > 5 * 1024 * 1024) {
        return `Error: File too large (${(stat.size / 1024 / 1024).toFixed(1)}MB). Maximum: 5MB. Use offset/limit to read specific ranges.`;
      }

      const content = readFileSync(check.resolved, 'utf-8');
      const lines = content.split('\n');
      const startLine = Math.max(1, offset);
      const endLine = limit ? startLine + limit - 1 : lines.length;
      const sliced = lines.slice(startLine - 1, endLine);

      // 添加行号（类似 cat -n）
      const numbered = sliced.map((line, i) => `${String(startLine + i).padStart(6)} │ ${line}`);
      const header = `File: ${filePath} (${lines.length} lines, ${stat.size} bytes)`;
      const rangeInfo = limit ? ` [showing lines ${startLine}-${Math.min(endLine, lines.length)}]` : '';

      return `${header}${rangeInfo}\n${'─'.repeat(60)}\n${numbered.join('\n')}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`fs_read error: ${filePath}`, err);
      return `Error reading file: ${msg}`;
    }
  },
};

function listDirectory(dirPath: string, sessionId: string): string {
  if (!existsSync(dirPath)) {
    return `Directory does not exist. Your workspace is empty — use fs_write to create files.`;
  }

  const root = getWorkspaceRoot(sessionId);
  const relDir = relative(root, dirPath) || '.';
  const entries = readdirSync(dirPath, { withFileTypes: true });

  if (entries.length === 0) {
    return `Directory "${relDir}" is empty.`;
  }

  const lines = [`Directory: ${relDir}/`, ''];
  for (const entry of entries.sort((a, b) => {
    // 目录排前面
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
  })) {
    if (entry.isDirectory()) {
      lines.push(`  📁 ${entry.name}/`);
    } else {
      try {
        const stat = statSync(join(dirPath, entry.name));
        const size = stat.size < 1024
          ? `${stat.size}B`
          : stat.size < 1024 * 1024
            ? `${(stat.size / 1024).toFixed(1)}KB`
            : `${(stat.size / 1024 / 1024).toFixed(1)}MB`;
        lines.push(`  📄 ${entry.name} (${size})`);
      } catch {
        lines.push(`  📄 ${entry.name}`);
      }
    }
  }

  return lines.join('\n');
}
