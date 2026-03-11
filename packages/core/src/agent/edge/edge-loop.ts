/**
 * Edge Agent Loop — 在客户端运行的 agent 循环
 *
 * 依赖 EdgeBackend 接口，不关心底层是 local 还是 server。
 * 输出 AgentEvent 事件流。
 */

import { randomBytes } from 'node:crypto';
import type { AgentEvent, AnthropicToolDef } from '../types.js';
import type { EdgeBackend, EdgeMessage, ModelEvent } from './types.js';
import { getLocalToolDefs, executeLocalTool } from './local-tools.js';
import { initLocalMcp, shutdownLocalMcp, isMcpTool } from './mcp-local.js';

const MAX_ROUNDS = 10;
const LOCAL_TOOL_NAMES = new Set(['fs_read', 'fs_write', 'fs_edit', 'run_command', 'manage_workspace', 'web_search', 'web_fetch']);

function genMsgId(): string {
  return 'emsg_' + randomBytes(8).toString('hex');
}

interface EdgeLoopOpts {
  backend: EdgeBackend;
  message: string;
  sessionId?: string;
  cwd: string;
  /** 自定义 system prompt（可选） */
  systemPrompt?: string;
}

const DEFAULT_SYSTEM_PROMPT = `你是一个 AI 助手，可以帮助用户进行代码开发、文件操作和信息查询。

可用能力：
- 读写编辑本地文件
- 执行终端命令
- 搜索工作目录
- 搜索互联网和获取网页
- 查询远程数据（如有 Gateway 连接）

请简洁专业地回答用户问题。如果需要操作文件或执行命令，直接使用工具。`;

/**
 * 运行 Edge agent loop，生成 AgentEvent 流。
 */
export async function* edgeAgentLoop(opts: EdgeLoopOpts): AsyncGenerator<AgentEvent> {
  const { backend, message, cwd, systemPrompt } = opts;

  // 1. 确保 session
  const sessionId = await backend.ensureSession(opts.sessionId, message.slice(0, 50));
  yield { event: 'session_created', data: { session_id: sessionId } };

  // 2. 收集工具
  const localToolDefs = getLocalToolDefs();
  let remoteToolDefs: AnthropicToolDef[] = [];
  try {
    remoteToolDefs = await backend.listRemoteTools();
  } catch {
    // 个人本地版或 Gateway 不可达：无远程工具
  }

  // 本地 MCP 工具（从 .mcp.json 或 ~/.jowork/mcp.json 加载）
  let mcpExecutor: ((name: string, input: Record<string, unknown>) => Promise<string>) | null = null;
  let mcpToolDefs: AnthropicToolDef[] = [];
  try {
    const mcp = await initLocalMcp(cwd);
    mcpToolDefs = mcp.toolDefs;
    mcpExecutor = mcp.executeTool;
  } catch {
    // MCP 加载失败不影响其他功能
  }

  const allToolDefs = [...localToolDefs, ...remoteToolDefs, ...mcpToolDefs];

  yield { event: 'engine_info', data: { engine: 'edge', model: 'via-gateway' } };

  // 3. 构建对话历史
  const history = await backend.loadHistory(sessionId);
  const messages: Array<{ role: string; content: unknown }> = [];

  // 恢复历史
  for (const h of history) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({ role: h.role, content: h.content });
    }
  }

  // 追加当前用户消息
  messages.push({ role: 'user', content: message });

  // 保存用户消息
  await backend.saveMessage({
    client_msg_id: genMsgId(),
    session_id: sessionId,
    role: 'user',
    content: message,
  });

  // 4. Agent loop
  const system = systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    yield { event: 'thinking', data: { round } };

    // 调用模型
    let fullContent = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    let endTurn = false;
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCost = 0;
    let modelName = '';

    for await (const event of backend.callModel(system, messages, allToolDefs)) {
      switch (event.type) {
        case 'text_delta':
          fullContent += event.delta;
          yield { event: 'text_delta', data: { delta: event.delta } };
          break;
        case 'tool_use':
          toolCalls.push({ id: event.id, name: event.name, input: event.input });
          yield { event: 'tool_call', data: { id: event.id, name: event.name, input: event.input } };
          break;
        case 'end_turn':
          totalTokensIn += event.tokens_in;
          totalTokensOut += event.tokens_out;
          totalCost += event.cost_usd;
          modelName = event.model;
          if (!event.content && !toolCalls.length) {
            fullContent = event.content;
          }
          endTurn = true;
          break;
        case 'error':
          yield { event: 'error', data: { message: event.message } };
          yield { event: 'stopped', data: {} };
          return;
      }
    }

    yield { event: 'usage', data: { tokens_in: totalTokensIn, tokens_out: totalTokensOut, model: modelName, cost_usd: totalCost } };

    // 无工具调用 → 最终回答
    if (toolCalls.length === 0) {
      if (fullContent) {
        // 保存 assistant 回复
        await backend.saveMessage({
          client_msg_id: genMsgId(),
          session_id: sessionId,
          role: 'assistant',
          content: fullContent,
          tokens: totalTokensIn + totalTokensOut,
          model: modelName,
          cost_usd: totalCost,
        });
        yield { event: 'text_done', data: { content: fullContent } };
      }
      break;
    }

    // 有工具调用 → 追加 assistant 消息
    messages.push({
      role: 'assistant',
      content: [
        ...(fullContent ? [{ type: 'text', text: fullContent }] : []),
        ...toolCalls.map(tc => ({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })),
      ],
    });

    // 执行工具并收集结果
    const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

    for (const tc of toolCalls) {
      const start = Date.now();
      let result: string;
      let status: 'success' | 'error' = 'success';
      let source: 'edge_local' | 'edge_remote';

      try {
        if (LOCAL_TOOL_NAMES.has(tc.name)) {
          // 本地工具
          result = await executeLocalTool(tc.name, tc.input, cwd);
          source = 'edge_local';
        } else if (isMcpTool(tc.name) && mcpExecutor) {
          // 本地 MCP 工具
          result = await mcpExecutor(tc.name, tc.input);
          source = 'edge_local';
        } else {
          // 远程工具
          result = await backend.executeRemoteTool(tc.name, tc.input, {
            user_id: 'edge', // ServerBackend 用 JWT 认证，此处仅为接口兼容
            role: 'admin' as import('../../types.js').Role,
            session_id: sessionId,
          });
          source = 'edge_remote';
        }
      } catch (err) {
        result = `Error: ${String(err)}`;
        status = 'error';
        source = LOCAL_TOOL_NAMES.has(tc.name) ? 'edge_local' : 'edge_remote';
      }

      const duration_ms = Date.now() - start;
      const preview = result.length > 200 ? result.slice(0, 200) + '...' : result;

      yield { event: 'tool_result', data: { id: tc.id, name: tc.name, result_preview: preview, status, duration_ms } };

      // 保存 tool 消息
      await backend.saveMessage({
        client_msg_id: genMsgId(),
        session_id: sessionId,
        role: 'tool_result',
        content: result,
        tool_name: tc.name,
        tool_call_id: tc.id,
        tool_status: status,
        source,
      });

      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
    }

    // 追加工具结果到消息历史
    messages.push({ role: 'user', content: toolResults });
  }

  // 清理 MCP 资源
  await shutdownLocalMcp();

  yield { event: 'stopped', data: {} };
}
