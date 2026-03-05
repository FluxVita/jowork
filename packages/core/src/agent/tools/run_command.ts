/** run_command — Free tier stub. Real impl in packages/premium */
import type { Tool } from '../types.js';
export const runCommandTool: Tool = {
  name: 'run_command',
  description: '（Premium 功能）在 Gateway 服务器执行受限 Shell 命令',
  input_schema: { type: 'object', properties: {} },
  async execute(_input, _ctx) { return '此工具需要 Premium 版本。'; },
};
