/** query_oss — Free tier stub. Real impl in packages/premium */
import type { Tool } from '../types.js';
export const queryOssTool: Tool = {
  name: 'query_oss_sessions',
  description: '（Premium 功能）查询阿里云 OSS 原始对话日志',
  input_schema: { type: 'object', properties: {} },
  async execute(_input, _ctx) { return '此工具需要 Premium 版本。'; },
};
