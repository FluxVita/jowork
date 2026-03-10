import type { AnthropicToolDef, ToolContext } from '../types.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool-provider');

// ─── Tool Provider 统一抽象（OpenClaw Phase 0） ───
// 三种 Provider 平等共存：builtin / MCP / Skill
// Agent 看到统一的 tool list，自己判断调用什么
// 用户可在 Admin UI 中自由启用/禁用任意 tool

export type ToolProviderType = 'builtin' | 'mcp' | 'skill';

export interface ToolProvider {
  readonly type: ToolProviderType;
  readonly id: string;
  readonly name: string;

  /** 列出此 provider 提供的所有工具定义 */
  listTools(): Promise<AnthropicToolDef[]>;

  /** 执行指定工具 */
  executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string>;

  /** 可选健康检查 */
  healthCheck?(): Promise<boolean>;
}

/**
 * 全局 Tool Registry — 合并所有 Provider 的 tools，呈现给 agent
 *
 * 当多个 provider 提供同名 tool 时，两者都保留但加前缀区分。
 * Agent 看到所有 tools，自己判断用哪个。
 * 用户也可以在设置里禁用某些 tools。
 */
export class ToolRegistry {
  private providers: Map<string, ToolProvider> = new Map();
  /** 用户级别的 tool 禁用列表（tool name → disabled） */
  private disabledTools: Set<string> = new Set();

  registerProvider(provider: ToolProvider): void {
    if (this.providers.has(provider.id)) {
      log.info(`Provider ${provider.id} re-registered`);
    }
    this.providers.set(provider.id, provider);
    log.info(`Registered provider: ${provider.id} (${provider.type})`);
  }

  removeProvider(id: string): void {
    this.providers.delete(id);
    log.info(`Removed provider: ${id}`);
  }

  getProvider(id: string): ToolProvider | undefined {
    return this.providers.get(id);
  }

  getAllProviders(): ToolProvider[] {
    return Array.from(this.providers.values());
  }

  /** 禁用指定工具（用户设置） */
  disableTool(name: string): void {
    this.disabledTools.add(name);
  }

  /** 启用指定工具（用户设置） */
  enableTool(name: string): void {
    this.disabledTools.delete(name);
  }

  /**
   * 合并所有 provider 的 tools（考虑用户的启用/禁用设置）
   *
   * 冲突处理策略：
   * - builtin tool 保留原名
   * - MCP tool 同名时加 mcp_ 前缀
   * - Skill tool 同名时加 skill_ 前缀
   */
  async getAvailableTools(): Promise<AnthropicToolDef[]> {
    const allTools: AnthropicToolDef[] = [];
    const nameSet = new Set<string>();

    // 按优先级遍历：builtin → skill → mcp
    const sortedProviders = Array.from(this.providers.values()).sort((a, b) => {
      const order: Record<ToolProviderType, number> = { builtin: 0, skill: 1, mcp: 2 };
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    });

    for (const provider of sortedProviders) {
      try {
        const tools = await provider.listTools();
        for (const tool of tools) {
          // 跳过被禁用的工具
          if (this.disabledTools.has(tool.name)) continue;

          // 同名冲突：后来者加前缀
          let finalName = tool.name;
          if (nameSet.has(tool.name)) {
            finalName = `${provider.type}_${tool.name}`;
            if (nameSet.has(finalName)) continue; // 连前缀名都重复就跳过
          }

          nameSet.add(finalName);
          allTools.push({
            name: finalName,
            description: tool.description,
            input_schema: tool.input_schema,
          });
        }
      } catch (err) {
        log.warn(`Failed to list tools from provider ${provider.id}: ${err}`);
      }
    }

    return allTools;
  }

  /**
   * 执行工具 — 根据 tool name 路由到对应 provider
   *
   * 路由策略：
   * 1. 如果 name 以 mcp_ 或 skill_ 开头，尝试对应 provider
   * 2. 否则遍历所有 provider 找到第一个能执行的
   */
  async executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    // 尝试从前缀推断 provider
    for (const [prefix, type] of [['mcp_', 'mcp'], ['skill_', 'skill']] as const) {
      if (name.startsWith(prefix)) {
        const realName = name.slice(prefix.length);
        for (const p of this.providers.values()) {
          if (p.type === type) {
            try {
              return await p.executeTool(realName, input, ctx);
            } catch { /* try next provider of same type */ }
          }
        }
      }
    }

    // 遍历所有 provider（builtin 优先）
    const sorted = Array.from(this.providers.values()).sort((a, b) => {
      const order: Record<ToolProviderType, number> = { builtin: 0, skill: 1, mcp: 2 };
      return (order[a.type] ?? 9) - (order[b.type] ?? 9);
    });

    for (const provider of sorted) {
      try {
        return await provider.executeTool(name, input, ctx);
      } catch {
        // provider 不认识这个 tool，继续尝试下一个
      }
    }

    throw new Error(`Tool not found across all providers: ${name}`);
  }
}

/** 全局单例 */
export const globalToolRegistry = new ToolRegistry();
