/**
 * agent/tools/fs_edit.ts — Phase 2.2: File System Edit Tool (P1)
 *
 * Agent 可在 workspace 内精确编辑文件（old_string → new_string）。
 * 安全：所有路径必须在 data/workspaces/{session_id}/ 内。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, normalize } from 'node:path';
import type { Tool, ToolContext } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool:fs_edit');

/** 获取 workspace 根目录 */
function getWorkspaceRoot(sessionId: string): string {
  return resolve(process.cwd(), 'data', 'workspaces', sessionId);
}

/** 规范化并验证路径安全 */
function safePath(sessionId: string, filePath: string): { valid: boolean; resolved: string; error?: string } {
  const root = getWorkspaceRoot(sessionId);
  const normalized = normalize(filePath);

  if (normalized.startsWith('/') || normalized.startsWith('\\')) {
    return { valid: false, resolved: '', error: 'Absolute paths are not allowed.' };
  }

  const resolved = resolve(root, normalized);

  if (!resolved.startsWith(root)) {
    return { valid: false, resolved: '', error: 'Path traversal detected.' };
  }

  return { valid: true, resolved };
}

export const fsEditTool: Tool = {
  name: 'fs_edit',
  description:
    'Make precise edits to a file in your workspace using string replacement. Provide old_string (the exact text to find) and new_string (what to replace it with). The old_string must uniquely match exactly one location in the file. For creating new files or full rewrites, use fs_write instead.',
  input_schema: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative file path within your workspace',
      },
      old_string: {
        type: 'string',
        description: 'The exact text to find and replace (must be unique in the file)',
      },
      new_string: {
        type: 'string',
        description: 'The replacement text',
      },
      replace_all: {
        type: 'boolean',
        description: 'If true, replace all occurrences instead of requiring uniqueness (default: false)',
      },
    },
    required: ['path', 'old_string', 'new_string'],
  },

  async execute(input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const filePath = input['path'] as string;
    const oldString = input['old_string'] as string;
    const newString = input['new_string'] as string;
    const replaceAll = input['replace_all'] as boolean | undefined;

    if (!filePath) return 'Error: path is required.';
    if (!oldString) return 'Error: old_string is required.';
    if (newString === undefined || newString === null) return 'Error: new_string is required.';
    if (oldString === newString) return 'Error: old_string and new_string are identical.';

    const check = safePath(ctx.session_id, filePath);
    if (!check.valid) return `Error: ${check.error}`;

    if (!existsSync(check.resolved)) {
      return `Error: File not found: ${filePath}. Use fs_write to create new files.`;
    }

    try {
      const content = readFileSync(check.resolved, 'utf-8');
      const occurrences = countOccurrences(content, oldString);

      if (occurrences === 0) {
        // 提供上下文帮助 agent 定位问题
        const preview = content.length > 500 ? content.slice(0, 500) + '\n...(truncated)' : content;
        return `Error: old_string not found in ${filePath}.\n\nFile preview:\n${preview}`;
      }

      if (occurrences > 1 && !replaceAll) {
        return `Error: old_string matches ${occurrences} locations in ${filePath}. Either:\n1. Provide more surrounding context to make old_string unique\n2. Set replace_all=true to replace all occurrences`;
      }

      let newContent: string;
      let replacedCount: number;

      if (replaceAll) {
        newContent = content.split(oldString).join(newString);
        replacedCount = occurrences;
      } else {
        // 只替换第一次出现
        const idx = content.indexOf(oldString);
        newContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
        replacedCount = 1;
      }

      writeFileSync(check.resolved, newContent, 'utf-8');

      const linesBefore = content.split('\n').length;
      const linesAfter = newContent.split('\n').length;
      const lineDiff = linesAfter - linesBefore;

      return `Edit applied to ${filePath}: ${replacedCount} replacement(s)${lineDiff !== 0 ? ` (${lineDiff > 0 ? '+' : ''}${lineDiff} lines)` : ''}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`fs_edit error: ${filePath}`, err);
      return `Error editing file: ${msg}`;
    }
  },
};

function countOccurrences(text: string, search: string): number {
  let count = 0;
  let pos = 0;
  while ((pos = text.indexOf(search, pos)) !== -1) {
    count++;
    pos += search.length;
  }
  return count;
}
