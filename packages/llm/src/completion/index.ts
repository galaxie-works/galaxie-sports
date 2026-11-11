/** Clientes de texto livre (CompletionClient) de cada provedor e a fábrica por nome. */
import { LlmError } from '../errors.js';
import type { CompletionClient, LlmProviderId } from '../types.js';
import { AnthropicCompletionClient } from './anthropic.js';
import type { CompletionClientOptions } from './base.js';
import { GeminiCompletionClient } from './gemini.js';
import { DeepSeekCompletionClient, OpenAiCompletionClient } from './openai-compatible.js';

export * from './base.js';
export * from './anthropic.js';
export * from './gemini.js';
export * from './openai-compatible.js';

/** Variável da chave de cada provedor. */
export const PROVIDER_KEY_ENV: Readonly<Record<LlmProviderId, string>> = {
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  gemini: 'GEMINI_API_KEY',
  deepseek: 'DEEPSEEK_API_KEY',
};

/** Cliente de texto livre do provedor (ex.: o escolhido por função em Ajustes). */
export function createCompletionClient(
  provider: LlmProviderId,
  options: CompletionClientOptions,
): CompletionClient {
  switch (provider) {
    case 'openai':
      return new OpenAiCompletionClient(options);
    case 'anthropic':
      return new AnthropicCompletionClient(options);
    case 'gemini':
      return new GeminiCompletionClient(options);
    case 'deepseek':
      return new DeepSeekCompletionClient(options);
    default:
      throw new LlmError(`Provedor de IA desconhecido: ${String(provider)}.`, 'config', false);
  }
}
