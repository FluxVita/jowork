/**
 * AI provider configuration.
 * Resolves API key, base URL, and model from environment variables.
 * Supports: Moonshot, OpenAI, DeepSeek, or any OpenAI-compatible API.
 *
 * Priority: MOONSHOT_API_KEY → OPENAI_API_KEY → ANTHROPIC_API_KEY
 * All use OpenAI chat/completions format except Anthropic.
 */

export interface ProviderConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  name: string;
  format: 'openai' | 'anthropic';
}

export function resolveProvider(): ProviderConfig | null {
  // 1. Moonshot (OpenAI-compatible)
  const moonshotKey = process.env['MOONSHOT_API_KEY'];
  if (moonshotKey) {
    return {
      apiKey: moonshotKey,
      baseUrl: process.env['MOONSHOT_BASE_URL'] || 'https://api.moonshot.cn/v1',
      model: process.env['MOONSHOT_MODEL'] || 'moonshot-v1-8k',
      name: 'Moonshot',
      format: 'openai',
    };
  }

  // 2. OpenAI
  const openaiKey = process.env['OPENAI_API_KEY'];
  if (openaiKey) {
    return {
      apiKey: openaiKey,
      baseUrl: process.env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1',
      model: process.env['OPENAI_MODEL'] || 'gpt-4o-mini',
      name: 'OpenAI',
      format: 'openai',
    };
  }

  // 3. Anthropic (native format)
  const anthropicKey = process.env['ANTHROPIC_API_KEY'];
  if (anthropicKey) {
    return {
      apiKey: anthropicKey,
      baseUrl: 'https://api.anthropic.com',
      model: process.env['ANTHROPIC_MODEL'] || 'claude-sonnet-4-20250514',
      name: 'Anthropic',
      format: 'anthropic',
    };
  }

  return null;
}
