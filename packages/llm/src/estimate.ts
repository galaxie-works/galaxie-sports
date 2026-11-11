/**
 * Estimativas de uma requisição antes de chamar (tokens e US$), usadas pela reserva do orçamento diário
 * (services/ai-agents, BudgetedLlmClient) e pelos provedores que conferem o gasto entre rodadas (Gemini).
 */
import { budgetPriceFor, searchUsdFor } from './pricing.js';
import type { LlmJsonRequest, LlmUsage } from './types.js';

/** `LlmUsage` com o número de buscas na web (campo extra preenchido pelos provedores). */
export type UsageWithSearches = LlmUsage & { webSearchCalls?: number };

/** Overhead aproximado de uma rodada com busca na web (resultados entram como tokens de entrada). */
export const WEB_SEARCH_TOKEN_ESTIMATE = 20_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 4_000;

/** Estimativa conservadora de tokens de uma requisição (~4 caracteres por token). */
export function estimateRequestTokens(req: LlmJsonRequest): number {
  const chars =
    req.system.length +
    req.messages.reduce((s, m) => s + m.content.length, 0) +
    JSON.stringify(req.schema).length;
  return (
    Math.ceil(chars / 4) +
    (req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS) +
    (req.webSearch ? WEB_SEARCH_TOKEN_ESTIMATE : 0)
  );
}

/** Buscas presumidas numa chamada com busca quando não há teto configurado. */
export const UNCAPPED_SEARCH_ESTIMATE = 10;

/**
 * Estimativa conservadora em US$ de uma requisição: tokens de entrada (com o overhead da busca) e a saída
 * máxima ao preço do modelo, mais o teto de buscas ao preço por busca do provedor. Modelo fora da tabela
 * de preços usa o preço mais caro do provedor (sem provedor conhecido, conta só as buscas).
 */
export function estimateRequestUsd(req: LlmJsonRequest, model: string, provider: string): number {
  const p = budgetPriceFor(model, provider);
  const outputTokens = req.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const inputTokens = Math.max(0, estimateRequestTokens(req) - outputTokens);
  const tokensUsd = p ? (inputTokens * p.input + outputTokens * p.output) / 1_000_000 : 0;
  const searches = req.webSearch ? (req.maxSearches ?? UNCAPPED_SEARCH_ESTIMATE) : 0;
  return tokensUsd + searches * searchUsdFor(provider);
}
