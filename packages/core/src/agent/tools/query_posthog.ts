/** query_posthog — Free tier stub. Real impl in packages/premium */
import type { Tool } from '../types.js';
export const queryPosthogTool: Tool = {
  name: 'query_posthog',
  description: '（Premium 功能）查询 PostHog 用户行为数据',
  input_schema: { type: 'object', properties: {} },
  async execute(_input, _ctx) { return '此工具需要 Premium 版本。'; },
};
