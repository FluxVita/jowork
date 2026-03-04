// @jowork/core/models — basic model router (user-supplied API key)
// Advanced routing (Klaude, multi-model) is in @jowork/premium

import type { ModelConfig } from '../types.js';

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

/** Resolve model from env if not explicitly provided */
export function resolveModel(): ModelConfig {
  const provider = (process.env['MODEL_PROVIDER'] ?? 'anthropic') as ModelConfig['provider'];
  const model = process.env['MODEL_NAME'] ?? 'claude-3-5-sonnet-latest';
  const apiKey = process.env['ANTHROPIC_API_KEY'] ?? process.env['OPENAI_API_KEY'];
  const baseUrl = process.env['MODEL_BASE_URL'];
  const cfg: ModelConfig = { provider, model };
  if (apiKey) cfg.apiKey = apiKey;
  if (baseUrl) cfg.baseUrl = baseUrl;
  return cfg;
}

/**
 * Send a chat request to the configured model.
 * This is a minimal implementation — just calls the Anthropic Messages API directly
 * using native fetch (no SDK dependency in core).
 */
export async function chat(
  messages: ChatMessage[],
  opts: ChatOptions = {},
): Promise<ChatResponse> {
  const model = opts.model ?? resolveModel();

  if (model.provider === 'anthropic') {
    return callAnthropic(messages, model, opts);
  }

  throw new Error(`Model provider '${model.provider}' not supported in core. Use @jowork/premium for extended routing.`);
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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
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
  return {
    content: text,
    inputTokens: data.usage.input_tokens,
    outputTokens: data.usage.output_tokens,
  };
}
