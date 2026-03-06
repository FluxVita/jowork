import { searchDataTool } from './search_data.js';
import { fetchContentTool } from './fetch_content.js';
import { listSourcesTool } from './list_sources.js';
import { runQueryTool } from './run_query.js';
import { readMemoryTool } from './read_memory.js';
import { writeMemoryTool } from './write_memory.js';
import { queryPosthogTool } from './query_posthog.js';
import { queryOssTool } from './query_oss.js';
import { createGitlabMrTool } from './create_gitlab_mr.js';
import { runCommandTool } from './run_command.js';
import { manageWorkspaceTool } from './manage_workspace.js';
import { listChatMessagesTool } from './list_chat_messages.js';
import { larkSendMessageTool } from './lark/send_message.js';
import { larkListChatsTool } from './lark/list_chats.js';
import { larkCreateCalendarEventTool } from './lark/create_calendar_event.js';
import { createLogger } from '../../utils/logger.js';
const log = createLogger('tool-registry');
const builtinTools = new Map();
const externalToolDefs = [];
function register(tool) {
    builtinTools.set(tool.name, tool);
    log.info(`Registered tool: ${tool.name}`);
}
/** 获取内置工具（用于 controller 执行） */
export function getBuiltinTool(name) {
    return builtinTools.get(name);
}
/** 获取工具（内置优先，向后兼容） */
export function getTool(name) {
    return builtinTools.get(name);
}
export function getAllTools() {
    return Array.from(builtinTools.values());
}
/** 获取所有工具定义（内置 + 外部） */
export function getToolDefinitions() {
    const builtin = getAllTools().map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
    }));
    return [...builtin, ...externalToolDefs];
}
/** 注册外部工具定义（来自 MCP / Skills） */
export function registerExternalToolDefs(defs) {
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
    register(createGitlabMrTool);
    register(runCommandTool);
    register(manageWorkspaceTool);
    register(larkSendMessageTool);
    register(larkListChatsTool);
    register(larkCreateCalendarEventTool);
    register(listChatMessagesTool);
    log.info(`${builtinTools.size} tools registered`);
}
//# sourceMappingURL=registry.js.map