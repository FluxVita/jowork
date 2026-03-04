// @jowork/core/models — model router + provider registry
// Advanced routing (circuit-breaker, Klaude) is in @jowork/premium

export * from './provider.js';
import { resolveProviderFromEnv, type ModelProvider } from './provider.js';
import type { ModelConfig } from '../types.js';

// ─── Chat types ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatOptions {
  model?: ModelConfig;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface ChatResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
}

// ─── Tool-use types (Anthropic native tool_use protocol) ─────────────────────

/** JSON-schema description of a tool, sent to the Anthropic API */
export interface ToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required?: string[];
  };
}

/** A tool_use block returned by the Anthropic API */
export interface ToolUseBlock {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Structured content block for internal API messages */
export type ApiContent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };

/** Internal message format — content can be plain string or structured array */
export interface ApiMessage {
  role: 'user' | 'assistant';
  content: string | ApiContent[];
}

/** Result of chatWithTools() — text + pending tool calls */
export interface ChatWithToolsResponse {
  text: string;
  toolCalls: ToolUseBlock[];
  inputTokens: number;
  outputTokens: number;
}

// ─── chatWithTools() — Anthropic tool_use protocol ───────────────────────────

/**
 * Single-turn call to Anthropic with tool definitions.
 * Returns the assistant's text and any tool_use blocks.
 * Use this in an agentic loop: execute tools, append tool_result messages, repeat.
 */
export async function chatWithTools(
  messages: ApiMessage[],
  tools: ToolSchema[],
  opts: ChatOptions = {},
): Promise<ChatWithToolsResponse> {
  const { provider, model, apiKey } = resolveProviderFromEnv();
  if (provider.apiFormat !== 'anthropic') {
    // Non-Anthropic providers: fall back to plain chat (no tool_use support)
    const plainMessages: ChatMessage[] = messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : _flattenContent(m.content),
    }));
    const resp = await chat(plainMessages, opts);
    return { text: resp.content, toolCalls: [], inputTokens: resp.inputTokens, outputTokens: resp.outputTokens };
  }

  const key = apiKey;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 8096,
    messages,
    tools,
  };
  if (opts.systemPrompt) body['system'] = opts.systemPrompt;

  const endpoint = process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com';
  const res = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${txt}`);
  }

  interface AnthropicToolResponse {
    content: Array<
      | { type: 'text'; text: string }
      | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    >;
    usage: { input_tokens: number; output_tokens: number };
  }

  const data = await res.json() as AnthropicToolResponse;
  const text = data.content.filter(b => b.type === 'text').map(b => (b as { type: 'text'; text: string }).text).join('');
  const toolCalls: ToolUseBlock[] = data.content
    .filter(b => b.type === 'tool_use')
    .map(b => {
      const tu = b as { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };
      return { id: tu.id, name: tu.name, input: tu.input };
    });

  return { text, toolCalls, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens };
}

/** Flatten structured content to a plain string (for non-Anthropic fallback) */
function _flattenContent(content: ApiContent[]): string {
  return content
    .map(c => {
      if (c.type === 'text') return c.text;
      if (c.type === 'tool_result') return `[tool_result: ${c.content}]`;
      return '';
    })
    .join('');
}

// ─── streamWithTools() — streaming Anthropic API with tool_use support ────────

/** Events emitted by streamWithTools() */
export type StreamEvent =
  | { type: 'chunk'; text: string }
  | { type: 'tool_complete'; tool: ToolUseBlock };

/**
 * Stream a chat response from Anthropic with tool support.
 * Yields text chunks as they arrive, plus complete ToolUseBlock events
 * when the model requests a tool call.
 *
 * Non-Anthropic fallback: calls chatWithTools() and emits a single chunk.
 */
export async function* streamWithTools(
  messages: ApiMessage[],
  tools: ToolSchema[],
  opts: ChatOptions = {},
): AsyncGenerator<StreamEvent> {
  const { provider, model, apiKey } = resolveProviderFromEnv();

  if (provider.apiFormat !== 'anthropic') {
    // Fallback: non-streaming, emit complete text as one chunk
    const resp = await chatWithTools(messages, tools, opts);
    if (resp.text) yield { type: 'chunk', text: resp.text };
    for (const tool of resp.toolCalls) yield { type: 'tool_complete', tool };
    return;
  }

  const key = apiKey;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 8096,
    messages,
    tools,
    stream: true,
  };
  if (opts.systemPrompt) body['system'] = opts.systemPrompt;

  const endpoint = process.env['ANTHROPIC_BASE_URL'] ?? 'https://api.anthropic.com';
  const res = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${txt}`);
  }
  if (!res.body) throw new Error('No response body from Anthropic streaming');

  // Track in-progress content blocks by index
  interface InProgressBlock {
    type: 'text' | 'tool_use';
    id?: string;
    name?: string;
    jsonBuf?: string;
  }
  const blocks = new Map<number, InProgressBlock>();

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        let evt: Record<string, unknown>;
        try { evt = JSON.parse(data) as Record<string, unknown>; }
        catch { continue; }

        const evtType = evt['type'] as string;

        if (evtType === 'content_block_start') {
          const idx = evt['index'] as number;
          const block = evt['content_block'] as Record<string, unknown>;
          if (block['type'] === 'tool_use') {
            blocks.set(idx, {
              type: 'tool_use',
              id: block['id'] as string,
              name: block['name'] as string,
              jsonBuf: '',
            });
          } else {
            blocks.set(idx, { type: 'text' });
          }
        } else if (evtType === 'content_block_delta') {
          const idx = evt['index'] as number;
          const delta = evt['delta'] as Record<string, unknown>;
          const deltaType = delta['type'] as string;

          if (deltaType === 'text_delta') {
            const text = delta['text'] as string;
            if (text) yield { type: 'chunk', text };
          } else if (deltaType === 'input_json_delta') {
            const block = blocks.get(idx);
            if (block?.type === 'tool_use') {
              block.jsonBuf = (block.jsonBuf ?? '') + (delta['partial_json'] as string ?? '');
            }
          }
        } else if (evtType === 'content_block_stop') {
          const idx = evt['index'] as number;
          const block = blocks.get(idx);
          if (block?.type === 'tool_use') {
            let input: Record<string, unknown> = {};
            try { input = JSON.parse(block.jsonBuf ?? '{}') as Record<string, unknown>; }
            catch { /* malformed JSON from model */ }
            yield { type: 'tool_complete', tool: { id: block.id!, name: block.name!, input } };
            blocks.delete(idx);
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Legacy resolveModel (kept for backward-compat) ──────────────────────────

/** @deprecated Use resolveProviderFromEnv() from ./provider instead */
export function resolveModel(): ModelConfig {
  const { provider, model, apiKey } = resolveProviderFromEnv();
  const cfg: ModelConfig = {
    provider: provider.id as ModelConfig['provider'],
    model,
  };
  if (apiKey) cfg.apiKey = apiKey;
  if (process.env['MODEL_BASE_URL']) cfg.baseUrl = process.env['MODEL_BASE_URL'];
  return cfg;
}

// ─── chat() ───────────────────────────────────────────────────────────────────

/**
 * Send a chat request using the configured model provider.
 * Supports Anthropic (native) and OpenAI-compatible APIs.
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> {
  if (opts.model) {
    // Legacy ModelConfig path
    if (opts.model.provider === 'anthropic') {
      return callAnthropic(messages, opts.model, opts);
    }
    throw new Error(`Provider '${opts.model.provider}' not supported via legacy ModelConfig`);
  }

  const { provider, model, apiKey } = resolveProviderFromEnv();
  if (provider.apiFormat === 'anthropic') {
    return callAnthropic(messages, { provider: 'anthropic', model, apiKey }, opts);
  }
  if (provider.apiFormat === 'openai') {
    return callOpenAI(messages, provider, model, apiKey, opts);
  }

  throw new Error(`Unknown API format: ${String(provider.apiFormat)}`);
}

// ─── chatStream() — yields text chunks via native streaming APIs ──────────────

/**
 * Stream a chat response from the configured provider.
 * Supports Anthropic native SSE and OpenAI-compatible SSE (Ollama, OpenAI, etc.)
 * Yields text chunks as they arrive.
 */
export async function* chatStream(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): AsyncGenerator<string> {
  const { provider, model, apiKey } = resolveProviderFromEnv();

  if (provider.apiFormat === 'anthropic') {
    yield* streamAnthropic(messages, { provider: 'anthropic', model, apiKey }, opts);
    return;
  }

  if (provider.apiFormat === 'openai') {
    yield* streamOpenAI(messages, provider, model, apiKey, opts);
    return;
  }

  // Fallback for unknown formats
  const response = await chat(messages, opts);
  yield response.content;
}

// ─── Ollama model auto-discovery ──────────────────────────────────────────────

interface OllamaTagsResponse {
  models: Array<{ name: string; size: number }>;
}

/**
 * Discover locally running Ollama models.
 * Returns an empty array if Ollama is not running.
 */
export async function discoverOllamaModels(): Promise<string[]> {
  const endpoint = process.env['OLLAMA_HOST'] ?? 'http://localhost:11434';
  try {
    const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = await res.json() as OllamaTagsResponse;
    return data.models.map(m => m.name);
  } catch {
    return [];
  }
}

async function* streamAnthropic(
  messages: ChatMessage[],
  model: ModelConfig,
  opts: ChatOptions,
): AsyncGenerator<string> {
  const apiKey = model.apiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const body: Record<string, unknown> = {
    model: model.model,
    max_tokens: opts.maxTokens ?? model.maxTokens ?? 8096,
    messages: messages.filter(m => m.role !== 'system'),
    stream: true,
  };

  const systemMsg = opts.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
  if (systemMsg) body['system'] = systemMsg;

  const endpoint = model.baseUrl ?? 'https://api.anthropic.com';
  const res = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  if (!res.body) throw new Error('No response body from Anthropic streaming');

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const evt = JSON.parse(data) as { type: string; delta?: { type: string; text?: string } };
          if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta' && evt.delta.text) {
            yield evt.delta.text;
          }
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ─── Anthropic ────────────────────────────────────────────────────────────────

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: { input_tokens: number; output_tokens: number };
}

async function callAnthropic(
  messages: ChatMessage[],
  model: ModelConfig,
  opts: ChatOptions,
): Promise<ChatResponse> {
  const apiKey = model.apiKey;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

  const body: Record<string, unknown> = {
    model: model.model,
    max_tokens: opts.maxTokens ?? model.maxTokens ?? 8096,
    messages: messages.filter(m => m.role !== 'system'),
  };

  const systemMsg = opts.systemPrompt ?? messages.find(m => m.role === 'system')?.content;
  if (systemMsg) body['system'] = systemMsg;

  const endpoint = model.baseUrl ?? 'https://api.anthropic.com';
  const res = await fetch(`${endpoint}/v1/messages`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json() as AnthropicResponse;
  const text = data.content.find(b => b.type === 'text')?.text ?? '';
  return { content: text, inputTokens: data.usage.input_tokens, outputTokens: data.usage.output_tokens };
}

// ─── OpenAI-compatible ────────────────────────────────────────────────────────

interface OpenAIResponse {
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number };
}

async function callOpenAI(
  messages: ChatMessage[],
  provider: ModelProvider,
  modelId: string,
  apiKey: string,
  opts: ChatOptions,
): Promise<ChatResponse> {
  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: opts.maxTokens ?? 8096,
    messages: messages.map(m => ({ role: m.role, content: m.content })),
  };

  const systemMsg = opts.systemPrompt;
  if (systemMsg) {
    (body['messages'] as ChatMessage[]).unshift({ role: 'system', content: systemMsg });
  }

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(`${provider.endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider.name} API error ${res.status}: ${text}`);
  }

  const data = await res.json() as OpenAIResponse;
  const content = data.choices[0]?.message.content ?? '';
  return { content, inputTokens: data.usage.prompt_tokens, outputTokens: data.usage.completion_tokens };
}

// ─── OpenAI-compatible SSE streaming ─────────────────────────────────────────

interface OpenAIStreamChunk {
  choices: Array<{ delta: { content?: string }; finish_reason?: string | null }>;
}

async function* streamOpenAI(
  messages: ChatMessage[],
  provider: ModelProvider,
  modelId: string,
  apiKey: string,
  opts: ChatOptions,
): AsyncGenerator<string> {
  const allMessages = messages.map(m => ({ role: m.role, content: m.content }));
  const systemMsg = opts.systemPrompt;
  if (systemMsg) allMessages.unshift({ role: 'system', content: systemMsg });

  const body: Record<string, unknown> = {
    model: modelId,
    max_tokens: opts.maxTokens ?? 8096,
    messages: allMessages,
    stream: true,
  };

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) headers['authorization'] = `Bearer ${apiKey}`;

  const res = await fetch(`${provider.endpoint}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${provider.name} API error ${res.status}: ${text}`);
  }

  if (!res.body) throw new Error(`No response body from ${provider.name} streaming`);

  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') return;

        try {
          const chunk = JSON.parse(data) as OpenAIStreamChunk;
          const text = chunk.choices[0]?.delta?.content;
          if (text) yield text;
        } catch {
          // ignore malformed SSE lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
