/**
 * AI provider configuration.
 * Resolves API key, base URL, and model from environment variables.
 * Supports: Moonshot, DeepSeek, OpenAI, or any OpenAI-compatible API + Anthropic.
 *
 * Priority: MOONSHOT → DEEPSEEK → OPENAI → ANTHROPIC
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
  // 1. Moonshot / Kimi (OpenAI-compatible)
  const moonshotKey = process.env['MOONSHOT_API_KEY'];
  if (moonshotKey) {
    return {
      apiKey: moonshotKey,
      baseUrl: process.env['MOONSHOT_BASE_URL'] || 'https://api.moonshot.cn/v1',
      model: process.env['MOONSHOT_MODEL'] || 'kimi-k2.5',
      name: 'Moonshot',
      format: 'openai',
    };
  }

  // 2. DeepSeek (OpenAI-compatible)
  const deepseekKey = process.env['DEEPSEEK_API_KEY'];
  if (deepseekKey) {
    return {
      apiKey: deepseekKey,
      baseUrl: process.env['DEEPSEEK_BASE_URL'] || 'https://api.deepseek.com/v1',
      model: process.env['DEEPSEEK_MODEL'] || 'deepseek-chat',
      name: 'DeepSeek',
      format: 'openai',
    };
  }

  // 3. OpenAI
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

  // 4. Anthropic (native format)
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
