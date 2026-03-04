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
