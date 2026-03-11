/**
 * Edge Local Tools — 在客户端直接执行的工具
 *
 * 这些工具不依赖 Gateway，直接操作用户本地文件系统和终端。
 * 与 Gateway 版本的同名工具功能一致，但无 DB 依赖。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { execSync } from 'node:child_process';
import type { AnthropicToolDef } from '../types.js';

export interface LocalTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  execute(input: Record<string, unknown>, cwd: string): Promise<string>;
}

// ─── fs_read ───

const fsReadTool: LocalTool = {
  name: 'fs_read',
  description: '读取本地文件内容。支持文本文件和目录列表。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件或目录路径（相对于工作目录或绝对路径）' },
      max_lines: { type: 'number', description: '最大行数（默认 500）' },
    },
    required: ['path'],
  },
  async execute(input, cwd) {
    const targetPath = resolve(cwd, input['path'] as string);
    const maxLines = (input['max_lines'] as number) ?? 500;

    const stat = statSync(targetPath);
    if (stat.isDirectory()) {
      const entries = readdirSync(targetPath, { withFileTypes: true });
      const lines = entries.map(e => `${e.isDirectory() ? '📁' : '📄'} ${e.name}`);
      return `Directory: ${targetPath}\n${lines.join('\n')}`;
    }

    const content = readFileSync(targetPath, 'utf-8');
    const lines = content.split('\n');
    if (lines.length > maxLines) {
      return `${lines.slice(0, maxLines).join('\n')}\n\n... (truncated, ${lines.length} total lines)`;
    }
    return content;
  },
};

// ─── fs_write ───

const fsWriteTool: LocalTool = {
  name: 'fs_write',
  description: '写入本地文件。创建新文件或覆盖已有文件。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      content: { type: 'string', description: '文件内容' },
    },
    required: ['path', 'content'],
  },
  async execute(input, cwd) {
    const targetPath = resolve(cwd, input['path'] as string);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, input['content'] as string, 'utf-8');
    return `Written ${(input['content'] as string).length} chars to ${targetPath}`;
  },
};

// ─── fs_edit ───

const fsEditTool: LocalTool = {
  name: 'fs_edit',
  description: '编辑本地文件。通过 old_text → new_text 替换实现精确编辑。',
  input_schema: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '文件路径' },
      old_text: { type: 'string', description: '要替换的原文（必须精确匹配）' },
      new_text: { type: 'string', description: '替换后的新文本' },
    },
    required: ['path', 'old_text', 'new_text'],
  },
  async execute(input, cwd) {
    const targetPath = resolve(cwd, input['path'] as string);
    const oldText = input['old_text'] as string;
    const newText = input['new_text'] as string;

    const content = readFileSync(targetPath, 'utf-8');
    const idx = content.indexOf(oldText);
    if (idx === -1) {
      return `Error: old_text not found in ${targetPath}`;
    }
    // 检查唯一性
    const secondIdx = content.indexOf(oldText, idx + 1);
    if (secondIdx !== -1) {
      return `Error: old_text matches multiple locations in ${targetPath}. Provide more context.`;
    }

    const edited = content.slice(0, idx) + newText + content.slice(idx + oldText.length);
    writeFileSync(targetPath, edited, 'utf-8');
    return `Edited ${targetPath}: replaced ${oldText.length} chars with ${newText.length} chars`;
  },
};

// ─── run_command ───

const runCommandTool: LocalTool = {
  name: 'run_command',
  description: '在本地终端执行命令。有 30 秒超时。',
  input_schema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Shell 命令' },
    },
    required: ['command'],
  },
  async execute(input, cwd) {
    const command = input['command'] as string;

    // 安全检查：禁止明显危险的命令
    const dangerous = ['rm -rf /', 'mkfs', 'dd if=', ':(){'];
    if (dangerous.some(d => command.includes(d))) {
      return 'Error: Command blocked for safety reasons';
    }

    try {
      const output = execSync(command, {
        cwd,
        timeout: 30_000,
        maxBuffer: 1024 * 1024, // 1MB
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      const trimmed = output.length > 5000 ? output.slice(0, 5000) + '\n... (truncated)' : output;
      return trimmed || '(no output)';
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      const stderr = e.stderr ?? '';
      const stdout = e.stdout ?? '';
      return `Exit code: non-zero\nstdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 2000)}`;
    }
  },
};

// ─── manage_workspace ───

const manageWorkspaceTool: LocalTool = {
  name: 'manage_workspace',
  description: '管理工作目录：列出文件树、搜索文件、搜索内容。',
  input_schema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: '操作：tree（文件树）/ find（搜索文件名）/ grep（搜索内容）',
        enum: ['tree', 'find', 'grep'],
      },
      pattern: { type: 'string', description: 'find/grep 的搜索模式' },
      max_depth: { type: 'number', description: 'tree 的最大深度（默认 3）' },
    },
    required: ['action'],
  },
  async execute(input, cwd) {
    const action = input['action'] as string;
    const pattern = (input['pattern'] as string) ?? '';
    const maxDepth = (input['max_depth'] as number) ?? 3;

    try {
      switch (action) {
        case 'tree': {
          const output = execSync(
            `find . -maxdepth ${maxDepth} -not -path '*/node_modules/*' -not -path '*/.git/*' | head -200`,
            { cwd, encoding: 'utf-8', timeout: 10_000 },
          );
          return output || '(empty directory)';
        }
        case 'find': {
          if (!pattern) return 'Error: pattern is required for find';
          const output = execSync(
            `find . -name "${pattern}" -not -path '*/node_modules/*' -not -path '*/.git/*' | head -50`,
            { cwd, encoding: 'utf-8', timeout: 10_000 },
          );
          return output || `No files matching "${pattern}"`;
        }
        case 'grep': {
          if (!pattern) return 'Error: pattern is required for grep';
          const output = execSync(
            `grep -rn "${pattern}" --include='*.ts' --include='*.js' --include='*.json' --include='*.md' . 2>/dev/null | head -50`,
            { cwd, encoding: 'utf-8', timeout: 10_000 },
          );
          return output || `No matches for "${pattern}"`;
        }
        default:
          return `Unknown action: ${action}`;
      }
    } catch (err: unknown) {
      const e = err as { stdout?: string; message?: string };
      return e.stdout || `Error: ${e.message}`;
    }
  },
};

// ─── web_search ───

const webSearchTool: LocalTool = {
  name: 'web_search',
  description: '搜索互联网。返回搜索结果摘要。',
  input_schema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
    },
    required: ['query'],
  },
  async execute(input, _cwd) {
    // 使用 DuckDuckGo Instant Answer API（无需 API key）
    const query = encodeURIComponent(input['query'] as string);
    try {
      const res = await fetch(`https://api.duckduckgo.com/?q=${query}&format=json&no_html=1`);
      const data = await res.json() as {
        Abstract?: string;
        AbstractText?: string;
        RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      };

      const parts: string[] = [];
      if (data.AbstractText) {
        parts.push(`Summary: ${data.AbstractText}`);
      }
      if (data.RelatedTopics) {
        for (const topic of data.RelatedTopics.slice(0, 5)) {
          if (topic.Text) parts.push(`- ${topic.Text}`);
        }
      }
      return parts.length > 0 ? parts.join('\n') : 'No results found';
    } catch (err) {
      return `Search error: ${String(err)}`;
    }
  },
};

// ─── web_fetch ───

const webFetchTool: LocalTool = {
  name: 'web_fetch',
  description: '获取网页内容。返回纯文本（去除 HTML 标签）。',
  input_schema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL 地址' },
      max_length: { type: 'number', description: '最大返回长度（默认 5000）' },
    },
    required: ['url'],
  },
  async execute(input, _cwd) {
    const url = input['url'] as string;
    const maxLength = (input['max_length'] as number) ?? 5000;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'JoWork-Edge-Agent/1.0' },
        signal: AbortSignal.timeout(10_000),
      });
      const html = await res.text();

      // 简单去标签
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      return text.length > maxLength ? text.slice(0, maxLength) + '... (truncated)' : text;
    } catch (err) {
      return `Fetch error: ${String(err)}`;
    }
  },
};

// ─── 导出 ───

export const LOCAL_TOOLS: LocalTool[] = [
  fsReadTool,
  fsWriteTool,
  fsEditTool,
  runCommandTool,
  manageWorkspaceTool,
  webSearchTool,
  webFetchTool,
];

/** 获取本地工具的 Anthropic 格式定义 */
export function getLocalToolDefs(): AnthropicToolDef[] {
  return LOCAL_TOOLS.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
}

/** 执行本地工具 */
export async function executeLocalTool(name: string, input: Record<string, unknown>, cwd: string): Promise<string> {
  const tool = LOCAL_TOOLS.find(t => t.name === name);
  if (!tool) throw new Error(`Unknown local tool: ${name}`);
  return tool.execute(input, cwd);
}
