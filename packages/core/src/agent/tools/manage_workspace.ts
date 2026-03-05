/** manage_workspace — Free tier stub. Real impl in packages/premium */
import type { Tool } from '../types.js';
export const manageWorkspaceTool: Tool = {
  name: 'manage_workspace',
  description: '（Premium 功能）管理临时工作区（clone/apply_file/commit_push/clean）',
  input_schema: { type: 'object', properties: {} },
  async execute(_input, _ctx) { return '此工具需要 Premium 版本。'; },
};
