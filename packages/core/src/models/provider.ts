// @jowork/core/models/provider — Model Provider dynamic registration (§14.1)
//
// Replaces hardcoded provider list with a registry that users can extend
// through the Admin UI or programmatically.

export type ApiFormat = 'anthropic' | 'openai';

export interface ModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  /** Approximate cost per 1M input tokens in USD */
  costPer1MInput?: number;
  /** Approximate cost per 1M output tokens in USD */
  costPer1MOutput?: number;
}

export interface ModelProvider {
  /** Stable unique ID, e.g. "anthropic", "openai", "ollama" */
  id: string;
  name: string;
  apiFormat: ApiFormat;
  endpoint: string;
  models: ModelInfo[];
  /** Returns true if the key is valid (optional — some providers skip this) */
  authenticate?(apiKey: string): Promise<boolean>;
}

// ─── Built-in providers ───────────────────────────────────────────────────────

export const ANTHROPIC_PROVIDER: ModelProvider = {
  id: 'anthropic',
  name: 'Anthropic',
  apiFormat: 'anthropic',
  endpoint: 'https://api.anthropic.com',
  models: [
    { id: 'claude-opus-4-6',             name: 'Claude Opus 4.6',     contextWindow: 200_000 },
    { id: 'claude-sonnet-4-6',           name: 'Claude Sonnet 4.6',   contextWindow: 200_000 },
    { id: 'claude-3-5-sonnet-latest',    name: 'Claude 3.5 Sonnet',   contextWindow: 200_000 },
    { id: 'claude-3-5-haiku-latest',     name: 'Claude 3.5 Haiku',    contextWindow: 200_000 },
  ],
};

export const OPENAI_PROVIDER: ModelProvider = {
  id: 'openai',
  name: 'OpenAI',
  apiFormat: 'openai',
  endpoint: 'https://api.openai.com/v1',
  models: [
    { id: 'gpt-4o',         name: 'GPT-4o',      contextWindow: 128_000 },
    { id: 'gpt-4o-mini',    name: 'GPT-4o Mini', contextWindow: 128_000 },
    { id: 'gpt-4.1',        name: 'GPT-4.1',     contextWindow: 1_000_000 },
  ],
};

export const OLLAMA_PROVIDER: ModelProvider = {
  id: 'ollama',
  name: 'Ollama (local)',
  apiFormat: 'openai',
  endpoint: 'http://localhost:11434/v1',
  models: [
    { id: 'llama3.2',   name: 'Llama 3.2',   contextWindow: 128_000 },
    { id: 'qwen2.5',    name: 'Qwen 2.5',    contextWindow: 128_000 },
    { id: 'mistral',    name: 'Mistral',      contextWindow: 32_000 },
  ],
};

// ─── Registry ────────────────────────────────────────────────────────────────

const providerRegistry = new Map<string, ModelProvider>();

// Register built-ins
[ANTHROPIC_PROVIDER, OPENAI_PROVIDER, OLLAMA_PROVIDER].forEach(p => providerRegistry.set(p.id, p));

export function registerModelProvider(provider: ModelProvider): void {
  providerRegistry.set(provider.id, provider);
}

export function getModelProvider(id: string): ModelProvider | undefined {
  return providerRegistry.get(id);
}

export function listModelProviders(): ModelProvider[] {
  return Array.from(providerRegistry.values());
}

/** Resolve provider + model from env vars — used by core chat() function */
export function resolveProviderFromEnv(): { provider: ModelProvider; model: string; apiKey: string } {
  const providerId = process.env['MODEL_PROVIDER'] ?? 'anthropic';
  const modelId    = process.env['MODEL_NAME']     ?? 'claude-3-5-sonnet-latest';

  const provider = getModelProvider(providerId);
  if (!provider) {
    throw new Error(`Unknown model provider: ${providerId}. Register it with registerModelProvider() first.`);
  }

  const apiKeyEnv = providerId === 'anthropic' ? 'ANTHROPIC_API_KEY'
    : providerId === 'openai'     ? 'OPENAI_API_KEY'
    : 'API_KEY';

  const apiKey = process.env[apiKeyEnv] ?? process.env['API_KEY'] ?? '';
  if (!apiKey && providerId !== 'ollama') {
    throw new Error(`${apiKeyEnv} is not set`);
  }

  // Allow custom endpoint override
  const customEndpoint = process.env['MODEL_BASE_URL'];
  if (customEndpoint) provider.endpoint = customEndpoint;

  return { provider, model: modelId, apiKey };
}
