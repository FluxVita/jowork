// @jowork/core/agent/engines/builtin — agentic loop using Anthropic native tool_use
//
// Uses streamWithTools() for real-time text streaming while supporting tool calls:
//   1. Stream text chunks via onChunk callback (character-level)
//   2. Collect complete tool_use blocks from the stream
//   3. Execute tools, append tool_result messages
//   4. Repeat until no tool calls remain or max turns exceeded

import { streamWithTools, type ApiMessage, type ApiContent } from '../../models/index.js';
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

/** Run the builtin agentic loop with streaming text and native tool_use */
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

  while (turnCount < BUILTIN_MAX_TURNS) {
    turnCount++;

    // Collect events from the streaming response
    let turnText = '';
    const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

    for await (const event of streamWithTools(apiMessages, TOOL_SCHEMAS, { systemPrompt: opts.systemPrompt })) {
      if (event.type === 'chunk') {
        turnText += event.text;
        opts.onChunk?.(event.text);
      } else if (event.type === 'tool_complete') {
        toolCalls.push(event.tool);
      }
    }

    if (toolCalls.length === 0) {
      // No tool calls — done. Store the final assistant message.
      storedMessages.push({
        id: generateId(),
        sessionId: opts.sessionId,
        role: 'assistant',
        content: turnText,
        createdAt: nowISO(),
      });
      break;
    }

    // Build the assistant message content array (text + tool_use blocks)
    const assistantContent: ApiContent[] = [];
    if (turnText) {
      assistantContent.push({ type: 'text', text: turnText });
    }
    for (const tc of toolCalls) {
      assistantContent.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
    }
    apiMessages.push({ role: 'assistant', content: assistantContent });

    // Execute each tool and collect results
    const toolResults: ApiContent[] = [];
    for (const tc of toolCalls) {
      const tool = BUILTIN_TOOLS.find(t => t.name === tc.name);
      const result = tool
        ? await tool.execute(tc.input, ctx).catch(e => `Error: ${String(e)}`)
        : `Unknown tool: ${tc.name}`;
      toolResults.push({ type: 'tool_result', tool_use_id: tc.id, content: result });
    }

    // Append tool results as a user message
    apiMessages.push({ role: 'user', content: toolResults });
  }

  // If loop exhausted without storing assistant message, store what we have
  if (!storedMessages.some(m => m.role === 'assistant')) {
    storedMessages.push({
      id: generateId(),
      sessionId: opts.sessionId,
      role: 'assistant',
      content: '(max turns reached)',
      createdAt: nowISO(),
    });
  }

  return { messages: storedMessages, turnCount };
}
