/**
 * LocalBackend — Edge sidecar 的本地模式后端
 *
 * 个人本地版：无 Gateway、无网络依赖。
 * - 模型 API: BYOK 直连（Anthropic / OpenRouter / OpenAI）
 * - 数据存储: JSON 文件（~/.jowork/sessions/）
 * - 远程工具: 无（返回空列表）
 */

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { EdgeBackend, ModelEvent, EdgeMessage } from './types.js';
import type { AnthropicToolDef, ToolContext } from '../types.js';

const DATA_DIR = join(homedir(), '.jowork');
const SESSIONS_DIR = join(DATA_DIR, 'sessions');

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function genSessionId(): string {
  return 'ses_local_' + randomBytes(6).toString('hex');
}

interface SessionMeta {
  session_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  engine: 'edge';
}

export class LocalBackend implements EdgeBackend {
  private apiKey: string;
  private apiProvider: string;
  private currentSessionId = '';

  constructor(apiKey: string, apiProvider: string = 'anthropic') {
    this.apiKey = apiKey;
    this.apiProvider = apiProvider;
    ensureDir(SESSIONS_DIR);
  }

  async *callModel(
    system: string,
    messages: Array<{ role: string; content: unknown }>,
    tools: AnthropicToolDef[],
  ): AsyncGenerator<ModelEvent> {
    const endpoint = this.getEndpoint();
    const model = this.getModel();
    const headers = this.getHeaders();
    const isOpenAICompat = this.apiProvider === 'openrouter' || this.apiProvider === 'openai';

    try {
      let body: Record<string, unknown>;

      if (isOpenAICompat) {
        // OpenRouter / OpenAI: system 作为第一条 message，工具用 function 格式
        const oaiMessages: Array<Record<string, unknown>> = [
          { role: 'system', content: system },
        ];
        // 展平消息：Anthropic 的一条 user message 含多个 tool_result → 多条 OpenAI tool message
        for (const m of messages) {
          const converted = this.toOpenAIMessages(m);
          oaiMessages.push(...converted);
        }
        body = { model, max_tokens: 4096, messages: oaiMessages };
        if (tools.length > 0) {
          body.tools = tools.map(t => ({
            type: 'function',
            function: { name: t.name, description: t.description, parameters: t.input_schema },
          }));
        }
      } else {
        // Anthropic: 原生 Messages API 格式
        body = { model, max_tokens: 4096, system, messages };
        if (tools.length > 0) {
          body.tools = tools;
        }
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const errText = await res.text().catch(() => '');
        yield { type: 'error', message: `Model API error (${res.status}): ${errText.slice(0, 500)}` };
        return;
      }

      const raw = await res.json() as Record<string, unknown>;

      if (isOpenAICompat) {
        // 解析 OpenAI 格式响应
        yield* this.parseOpenAIResponse(raw, model);
      } else {
        // 解析 Anthropic 格式响应
        yield* this.parseAnthropicResponse(raw, model);
      }
    } catch (err) {
      yield { type: 'error', message: `Model call failed: ${String(err)}` };
    }
  }

  private toOpenAIMessages(msg: { role: string; content: unknown }): Array<Record<string, unknown>> {
    // 将 Anthropic 格式的 message 转换为 OpenAI 格式（可能展开为多条）
    if (typeof msg.content === 'string') {
      return [{ role: msg.role, content: msg.content }];
    }
    if (Array.isArray(msg.content)) {
      const blocks = msg.content as Array<Record<string, unknown>>;

      // tool_result → 每个展开为独立的 OpenAI tool message
      if (blocks.length > 0 && blocks[0].type === 'tool_result') {
        return blocks
          .filter(b => b.type === 'tool_result')
          .map(b => ({
            role: 'tool',
            tool_call_id: b.tool_use_id as string,
            content: String(b.content ?? ''),
          }));
      }

      // assistant 消息：text + tool_use 混合
      const textParts: string[] = [];
      const toolCalls: Array<Record<string, unknown>> = [];
      for (const block of blocks) {
        if (block.type === 'text') textParts.push(block.text as string);
        if (block.type === 'tool_use') {
          toolCalls.push({
            id: block.id,
            type: 'function',
            function: { name: block.name, arguments: JSON.stringify(block.input) },
          });
        }
      }

      const result: Record<string, unknown> = { role: msg.role };
      result.content = textParts.length > 0 ? textParts.join('') : null;
      if (toolCalls.length > 0) result.tool_calls = toolCalls;
      return [result];
    }
    return [{ role: msg.role, content: String(msg.content) }];
  }

  private *parseAnthropicResponse(result: Record<string, unknown>, model: string): Generator<ModelEvent> {
    const content = result.content as Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> | undefined;
    const usage = result.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    let textContent = '';

    if (content) {
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          textContent += block.text;
          yield { type: 'text_delta', delta: block.text };
        } else if (block.type === 'tool_use' && block.id && block.name) {
          yield { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} };
        }
      }
    }

    yield {
      type: 'end_turn',
      content: textContent,
      tokens_in: usage?.input_tokens ?? 0,
      tokens_out: usage?.output_tokens ?? 0,
      cost_usd: 0,
      model: (result.model as string) ?? model,
    };
  }

  private *parseOpenAIResponse(result: Record<string, unknown>, model: string): Generator<ModelEvent> {
    const choices = result.choices as Array<{ message?: { content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }> | undefined;
    const usage = result.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let textContent = '';

    const msg = choices?.[0]?.message;
    if (msg?.content) {
      textContent = msg.content;
      yield { type: 'text_delta', delta: msg.content };
    }
    if (msg?.tool_calls) {
      for (const tc of msg.tool_calls) {
        let input: Record<string, unknown> = {};
        try { input = JSON.parse(tc.function.arguments); } catch { /* ignore */ }
        yield { type: 'tool_use', id: tc.id, name: tc.function.name, input };
      }
    }

    yield {
      type: 'end_turn',
      content: textContent,
      tokens_in: usage?.prompt_tokens ?? 0,
      tokens_out: usage?.completion_tokens ?? 0,
      cost_usd: 0,
      model: (result.model as string) ?? model,
    };
  }

  async listRemoteTools(): Promise<AnthropicToolDef[]> {
    // 个人本地版无 Gateway，没有远程工具
    return [];
  }

  async executeRemoteTool(_name: string, _input: Record<string, unknown>, _ctx: ToolContext): Promise<string> {
    throw new Error('Remote tools are not available in local mode (no Gateway)');
  }

  async saveMessage(msg: EdgeMessage): Promise<void> {
    const sessionDir = join(SESSIONS_DIR, msg.session_id);
    ensureDir(sessionDir);

    const messagesFile = join(sessionDir, 'messages.json');
    let messages: EdgeMessage[] = [];
    try {
      messages = JSON.parse(readFileSync(messagesFile, 'utf-8'));
    } catch { /* empty or not found */ }

    // 幂等去重
    if (messages.some(m => m.client_msg_id === msg.client_msg_id)) {
      return;
    }

    msg.created_at = msg.created_at ?? new Date().toISOString();
    messages.push(msg);
    writeFileSync(messagesFile, JSON.stringify(messages, null, 2), 'utf-8');

    // 更新 session meta
    const metaFile = join(sessionDir, 'meta.json');
    try {
      const meta: SessionMeta = JSON.parse(readFileSync(metaFile, 'utf-8'));
      meta.updated_at = new Date().toISOString();
      writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf-8');
    } catch { /* ignore */ }
  }

  async loadHistory(sessionId: string): Promise<EdgeMessage[]> {
    const messagesFile = join(SESSIONS_DIR, sessionId, 'messages.json');
    try {
      return JSON.parse(readFileSync(messagesFile, 'utf-8'));
    } catch {
      return [];
    }
  }

  async ensureSession(sessionId?: string, title?: string): Promise<string> {
    if (sessionId) {
      const metaFile = join(SESSIONS_DIR, sessionId, 'meta.json');
      if (existsSync(metaFile)) {
        this.currentSessionId = sessionId;
        return sessionId;
      }
    }

    // 创建新 session
    const newId = genSessionId();
    const sessionDir = join(SESSIONS_DIR, newId);
    ensureDir(sessionDir);

    const meta: SessionMeta = {
      session_id: newId,
      title: title ?? 'New Session',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      engine: 'edge',
    };
    writeFileSync(join(sessionDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf-8');
    writeFileSync(join(sessionDir, 'messages.json'), '[]', 'utf-8');

    this.currentSessionId = newId;
    return newId;
  }

  // ─── Private helpers ───

  private getEndpoint(): string {
    switch (this.apiProvider) {
      case 'openrouter':
        return 'https://openrouter.ai/api/v1/chat/completions';
      case 'openai':
        return 'https://api.openai.com/v1/chat/completions';
      case 'anthropic':
      default:
        return 'https://api.anthropic.com/v1/messages';
    }
  }

  private getModel(): string {
    switch (this.apiProvider) {
      case 'openrouter':
        return 'anthropic/claude-sonnet-4-20250514';
      case 'openai':
        return 'gpt-4o';
      case 'anthropic':
      default:
        return 'claude-sonnet-4-20250514';
    }
  }

  private getHeaders(): Record<string, string> {
    switch (this.apiProvider) {
      case 'openrouter':
        return {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://jowork.dev',
        };
      case 'openai':
        return {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        };
      case 'anthropic':
      default:
        return {
          'x-api-key': this.apiKey,
          'Content-Type': 'application/json',
          'anthropic-version': '2024-10-22',
        };
    }
  }
}
