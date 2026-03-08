/** query_aliyun_logs — Free tier stub. Real impl in packages/premium */
import type { Tool } from '../types.js';

export const queryAliyunLogsTool: Tool = {
  name: 'query_aliyun_logs',
  description: '（Premium 功能）查询阿里云 SLS 结构化日志',
  input_schema: { type: 'object', properties: {} },
  async execute(_input, _ctx) { return '此工具需要 Premium 版本。'; },
};

