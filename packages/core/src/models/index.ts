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
