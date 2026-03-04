// @jowork/core/agent/engines/builtin — simple agentic loop (max 25 turns)
// Uses Anthropic Messages API with tool_use. No SDK dependency.

import { chat } from '../../models/index.js';
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

/** Run the builtin agentic loop for up to BUILTIN_MAX_TURNS turns */
export async function runBuiltin(opts: RunOptions): Promise<RunResult> {
  const ctx: ToolContext = { userId: opts.userId, agentId: opts.agentId };
  const newMessages: Message[] = [];
  let turnCount = 0;

  // Build conversation history for the API
  const apiMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    ...opts.history.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    })),
    { role: 'user', content: opts.userMessage },
  ];

  newMessages.push({
    id: generateId(),
    sessionId: opts.sessionId,
    role: 'user',
    content: opts.userMessage,
    createdAt: nowISO(),
  });

  while (turnCount < BUILTIN_MAX_TURNS) {
    turnCount++;

    const response = await chat(apiMessages, { systemPrompt: opts.systemPrompt });
    const assistantMsg: Message = {
      id: generateId(),
      sessionId: opts.sessionId,
      role: 'assistant',
      content: response.content,
      createdAt: nowISO(),
    };
    newMessages.push(assistantMsg);
    apiMessages.push({ role: 'assistant', content: response.content });

    opts.onChunk?.(response.content);

    // Simple tool detection: look for <tool_call> XML or stop if no tool use
    const toolMatch = response.content.match(/<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/);
    if (!toolMatch) break; // No tool use → done

    let toolCall: { name: string; input: Record<string, unknown> };
    try {
      toolCall = JSON.parse(toolMatch[1] ?? '{}') as typeof toolCall;
    } catch {
      break;
    }

    const tool = BUILTIN_TOOLS.find(t => t.name === toolCall.name);
    const toolResult = tool
      ? await tool.execute(toolCall.input, ctx).catch(e => `Error: ${String(e)}`)
      : `Unknown tool: ${toolCall.name}`;

    // Feed tool result back as user message (simple approach)
    const resultContent = `<tool_result>\n${toolResult}\n</tool_result>`;
    apiMessages.push({ role: 'user', content: resultContent });
    newMessages.push({
      id: generateId(),
      sessionId: opts.sessionId,
      role: 'user',
      content: resultContent,
      createdAt: nowISO(),
    });
  }

  return { messages: newMessages, turnCount };
}
