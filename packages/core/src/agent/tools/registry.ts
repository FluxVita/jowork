import type { Tool, AnthropicToolDef, ToolContext } from '../types.js';
import type { ToolProvider } from './provider.js';
import { globalToolRegistry } from './provider.js';
import { searchDataTool } from './search_data.js';
import { fetchContentTool } from './fetch_content.js';
import { listSourcesTool } from './list_sources.js';
import { runQueryTool } from './run_query.js';
import { readMemoryTool } from './read_memory.js';
import { writeMemoryTool } from './write_memory.js';
import { queryPosthogTool } from './query_posthog.js';
import { queryOssTool } from './query_oss.js';
import { queryAliyunLogsTool } from './query_aliyun_logs.js';
import { createGitlabMrTool } from './create_gitlab_mr.js';
import { runCommandTool } from './run_command.js';
import { manageWorkspaceTool } from './manage_workspace.js';
import { listChatMessagesTool } from './list_chat_messages.js';
import { larkSendMessageTool } from './lark/send_message.js';
import { larkListChatsTool } from './lark/list_chats.js';
import { larkCreateCalendarEventTool } from './lark/create_calendar_event.js';
import { checkGitlabCiTool } from './check_gitlab_ci.js';
import { cronTool } from './cron.js';
import { fsReadTool } from './fs_read.js';
import { fsWriteTool } from './fs_write.js';
import { fsEditTool } from './fs_edit.js';
import { webSearchTool } from './web_search.js';
import { webFetchTool } from './web_fetch.js';
import { sessionsTool } from './sessions.js';
import { processTool } from './process.js';
import { gatewayTool } from './gateway.js';
import { createLogger } from '../../utils/logger.js';

const log = createLogger('tool-registry');

const builtinTools = new Map<string, Tool>();
const externalToolDefs: AnthropicToolDef[] = [];

function register(tool: Tool) {
  if (builtinTools.has(tool.name)) {
    log.info(`Skipped tool registration (already exists): ${tool.name}`);
    return;
  }
  builtinTools.set(tool.name, tool);
  log.info(`Registered tool: ${tool.name}`);
}

export function registerToolOverride(tool: Tool) {
  builtinTools.set(tool.name, tool);
  log.info(`Overrode tool: ${tool.name}`);
}

/** 获取内置工具（用于 controller 执行） */
export function getBuiltinTool(name: string): Tool | undefined {
  return builtinTools.get(name);
}

/** 获取工具（内置优先，向后兼容） */
export function getTool(name: string): Tool | undefined {
  return builtinTools.get(name);
}

export function getAllTools(): Tool[] {
  return Array.from(builtinTools.values());
}

/** 获取所有工具定义（内置 + 外部） */
export function getToolDefinitions(): AnthropicToolDef[] {
  const builtin = getAllTools().map(t => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  return [...builtin, ...externalToolDefs];
}

/** 注册外部工具定义（来自 MCP / Skills） */
export function registerExternalToolDefs(defs: AnthropicToolDef[]) {
  externalToolDefs.push(...defs);
  log.info(`Registered ${defs.length} external tool definitions`);
}

/** 清除外部工具定义 */
export function clearExternalToolDefs() {
  externalToolDefs.length = 0;
}

// 注册内置工具
export function initTools() {
  register(searchDataTool);
  register(fetchContentTool);
  register(listSourcesTool);
  register(runQueryTool);
  register(readMemoryTool);
  register(writeMemoryTool);
  register(queryPosthogTool);
  register(queryOssTool);
  register(queryAliyunLogsTool);
  register(createGitlabMrTool);
  register(runCommandTool);
  register(manageWorkspaceTool);
  register(checkGitlabCiTool);
  register(larkSendMessageTool);
  register(larkListChatsTool);
  register(larkCreateCalendarEventTool);
  register(listChatMessagesTool);
  // ─── Phase 2: New Agent Tools ───
  register(cronTool);
  register(fsReadTool);
  register(fsWriteTool);
  register(fsEditTool);
  register(webSearchTool);
  register(webFetchTool);
  register(sessionsTool);
  register(processTool);
  register(gatewayTool);
  log.info(`${builtinTools.size} tools registered`);

  // ─── Phase 2.11: 注册 BuiltinToolProvider 到全局 ToolRegistry ───
  globalToolRegistry.registerProvider(builtinToolProvider);
}

// ─── BuiltinToolProvider: 桥接旧 Map<string,Tool> 到新 ToolProvider 抽象 ───

const builtinToolProvider: ToolProvider = {
  type: 'builtin',
  id: 'builtin',
  name: 'Built-in Tools',

  async listTools(): Promise<AnthropicToolDef[]> {
    return getAllTools().map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    }));
  },

  async executeTool(name: string, input: Record<string, unknown>, ctx: ToolContext): Promise<string> {
    const tool = builtinTools.get(name);
    if (!tool) throw new Error(`Unknown builtin tool: ${name}`);
    return tool.execute(input, ctx);
  },

  async healthCheck(): Promise<boolean> {
    return builtinTools.size > 0;
  },
};
