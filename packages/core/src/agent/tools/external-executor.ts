/**
 * agent/tools/external-executor.ts — Phase 5.3: Unified External Tool Executor
 *
 * 统一路由外部工具执行（MCP 和 Skill），
 * 根据工具名前缀自动分发到对应执行器。
 */
import { executeMcpTool } from '../mcp-bridge.js';
import { executeSkillTool } from '../../skills/executor.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('external-executor');

/**
 * 统一外部工具执行入口
 *
 * 路由策略：
 * 1. mcp_ 前缀 → MCP 工具
 * 2. skill_ 前缀 → Skill 工具
 * 3. 无前缀 → 先尝试 MCP，再尝试 Skill
 */
export async function executeExternalTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  // MCP 工具
  if (name.startsWith('mcp_')) {
    const realName = name.slice(4);
    log.info(`Routing to MCP tool: ${realName}`);
    return executeMcpTool(realName, input);
  }

  // Skill 工具
  if (name.startsWith('skill_')) {
    const realName = name.slice(6);
    log.info(`Routing to Skill tool: ${realName}`);
    return executeSkillTool(realName, input);
  }

  // 无前缀：先 MCP 后 Skill
  try {
    return await executeMcpTool(name, input);
  } catch {
    try {
      return await executeSkillTool(name, input);
    } catch {
      throw new Error(`External tool not found: ${name}. Not available in MCP or Skill providers.`);
    }
  }
}
