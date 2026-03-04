// @jowork/core/agent/engines/builtin — agentic loop using Anthropic native tool_use
//
// Replaces XML-parsing hack with the proper Anthropic tool_use protocol:
//   1. Call chatWithTools() with all tool schemas
//   2. Execute any tool_use blocks returned
//   3. Append assistant message (with tool_use content) + user tool_result message
//   4. Repeat until no tool calls remain or max turns exceeded

import { chatWithTools, type ApiMessage, type ApiContent } from '../../models/index.js';
import { BUILTIN_TOOLS } from '../tools/index.js';
import type { ToolContext } from '../tools/index.js';
import type { Message } from '../../types.js';
import { generateId, nowISO } from '../../utils/index.js';

export const BUILTIN_MAX_TURNS = 25;

export interface RunOptions {
  sessionId: string;
  agentId: string;
  userId: string;
  systemPrompt: string;
  history: Message[];
  userMessage: string;
  onChunk?: (text: string) => void;
}

export interface RunResult {
  messages: Message[];
  turnCount: number;
}

/** Build Anthropic tool schemas from BUILTIN_TOOLS */
const TOOL_SCHEMAS = BUILTIN_TOOLS.map(t => ({
  name: t.name,
  description: t.description,
  input_schema: t.inputSchema,
}));

/** Run the builtin agentic loop using Anthropic native tool_use protocol */
export async function runBuiltin(opts: RunOptions): Promise<RunResult> {
  const ctx: ToolContext = { userId: opts.userId, agentId: opts.agentId };
  const storedMessages: Message[] = [];
  let turnCount = 0;

  // Build the API message history (internal format with structured content support)
  const apiMessages: ApiMessage[] = [
    ...opts.history.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: opts.userMessage },
  ];

  // Record the user message for storage
  storedMessages.push({
    id: generateId(),
    sessionId: opts.sessionId,
    role: 'user',
    content: opts.userMessage,
    createdAt: nowISO(),
  });

  let finalText = '';

  while (turnCount < BUILTIN_MAX_TURNS) {
    turnCount++;

    const response = await chatWithTools(apiMessages, TOOL_SCHEMAS, {
      systemPrompt: opts.systemPrompt,
    });

    finalText = response.text;
    opts.onChunk?.(response.text);

    if (response.toolCalls.length === 0) {
      // No tool calls — done. Store the final assistant message.
      storedMessages.push({
        id: generateId(),
        sessionId: opts.sessionId,
        role: 'assistant',
        content: response.text,
        createdAt: nowISO(),
      });
      break;
    }

    // Build the assistant message content array (text + tool_use blocks)
    const assistantContent: ApiContent[] = [];
    if (response.text) {
      assistantContent.push({ type: 'text', text: response.text });
    }
    for (const tc of response.toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    apiMessages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool and collect results
    const toolResults: ApiContent[] = [];
    for (const tc of response.toolCalls) {
      const tool = BUILTIN_TOOLS.find(t => t.name === tc.name);
      const result = tool
        ? await tool.execute(tc.input, ctx).catch(e => `Error: ${String(e)}`)
        : `Unknown tool: ${tc.name}`;
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
    }

    // Append tool results as a user message
    apiMessages.push({ role: 'user', content: toolResults });
  }

  // If loop exhausted without final text message, store what we have
  if (!storedMessages.some(m => m.role === 'assistant')) {
    storedMessages.push({
      id: generateId(),
      sessionId: opts.sessionId,
      role: 'assistant',
      content: finalText || '(no response)',
      createdAt: nowISO(),
    });
  }

  return { messages: storedMessages, turnCount };
}
