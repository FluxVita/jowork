// @jowork/premium/agent/tools — advanced tools (run_command, manage_workspace, etc.)

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { ToolDefinition } from '@jowork/core';

const execAsync = promisify(exec);

/** Run a shell command (Geek Mode only) */
export const runCommandTool: ToolDefinition = {
  name: 'run_command',
  description: 'Execute a shell command on the local machine (Geek Mode)',
  inputSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'The shell command to run' },
      cwd: { type: 'string', description: 'Working directory (optional)' },
    },
    required: ['command'],
  },
  async execute(input, _ctx) {
    const command = input['command'] as string;
    const cwd = input['cwd'] as string | undefined;
    try {
      const { stdout, stderr } = await execAsync(command, { cwd, timeout: 30_000 });
      return [stdout, stderr].filter(Boolean).join('\n').trim() || '(no output)';
    } catch (err) {
      return `Error: ${String(err)}`;
    }
  },
};

/** Manage workspace files */
export const manageWorkspaceTool: ToolDefinition = {
  name: 'manage_workspace',
  description: 'Read or list files in the workspace',
  inputSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', description: "'read' or 'list'" },
      path: { type: 'string', description: 'File or directory path' },
    },
    required: ['action', 'path'],
  },
  async execute(input, _ctx) {
    const { readFileSync, readdirSync } = await import('node:fs');
    const action = input['action'] as string;
    const path = input['path'] as string;
    try {
      if (action === 'read') return readFileSync(path, 'utf8');
      if (action === 'list') return readdirSync(path).join('\n');
      return `Unknown action: ${action}`;
    } catch (err) {
      return `Error: ${String(err)}`;
    }
  },
};

export const PREMIUM_TOOLS: ToolDefinition[] = [runCommandTool, manageWorkspaceTool];
