/** check_gitlab_ci — Free tier stub. Real impl in packages/premium */
import type { Tool } from '../types.js';
export const checkGitlabCiTool: Tool = {
  name: 'check_gitlab_ci',
  description: '（Premium 功能）检查 GitLab CI 流水线状态，获取失败 Job 的日志',
  input_schema: { type: 'object', properties: {} },
  async execute(_input, _ctx) { return '此工具需要 Premium 版本。'; },
};
