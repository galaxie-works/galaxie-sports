/**
 * Camada de IA independente de provedor, compartilhada pelos agentes internos (services/ai-agents) e pela
 * Cosmos AI:
 * - `LlmClient.generateJson` (saída JSON com schema, busca na web onde o provedor tem): OpenAiLlmClient,
 *   AnthropicLlmClient, GeminiLlmClient e DeepSeekLlmClient;
 * - `CompletionClient.complete` / `.stream` (texto livre, inteiro ou em streaming): createCompletionClient.
 * Contrato em ./types.ts; preços e erros base vêm de @galaxie/ai-ledger.
 */
export * from './types.js';
export * from './errors.js';
export * from './retry.js';
export * from './json-schema.js';
export * from './pricing.js';
export * from './estimate.js';
export * from './http.js';
export * from './completion/index.js';
export {
  countryFromPurpose,
  dedupeCitations,
  safeName,
  splitMessages,
  UsageMeter,
  withUsage,
} from './providers/common.js';
export {
  OPENAI_MAX_ALLOWED_DOMAINS,
  OpenAiLlmClient,
  type OpenAiClientOptions,
  type OpenAiResponsesApi,
} from './providers/openai.js';
export {
  AnthropicLlmClient,
  searchUsesFor,
  type AnthropicClientOptions,
  type AnthropicMessagesApi,
} from './providers/anthropic.js';
export {
  GEMINI_API_BASE,
  GeminiLlmClient,
  structureEstimate,
  type GeminiClientOptions,
} from './providers/gemini.js';
export { DeepSeekLlmClient, jsonSchemaNote, type DeepSeekClientOptions } from './providers/deepseek.js';
