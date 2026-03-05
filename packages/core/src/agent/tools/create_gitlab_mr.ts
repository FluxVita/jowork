/** create_gitlab_mr — Free tier stub. Real impl in packages/premium */
import type { Tool } from '../types.js';
export const createGitlabMrTool: Tool = {
  name: 'create_gitlab_mr',
  description: '（Premium 功能）创建分支、提交文件变更并开 MR',
  input_schema: { type: 'object', properties: {} },
  async execute(_input, _ctx) { return '此工具需要 Premium 版本。'; },
};
