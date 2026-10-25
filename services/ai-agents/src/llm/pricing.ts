/**
 * Tabela de preços para estimar custo (USD por 1 milhão de tokens, tier padrão, contexto curto).
 * Fontes oficiais conferidas em 2026-10-21:
 * - https://developers.openai.com/api/docs/pricing
 * - https://platform.claude.com/docs/en/about-claude/pricing (Anthropic, modelos atuais conferidos em 2026-10-25)
 * - https://ai.google.dev/gemini-api/docs/pricing (Gemini, conferida em 2026-10-23)
 * É uma ESTIMATIVA para orçamento e métricas — a fatura do provedor é a fonte da verdade.
 */
import type { LlmUsage } from './types.js';

export interface ModelPrice {
  input: number;
  cachedInput?: number;
  output: number;
}

export const PRICES_CHECKED_AT = '2026-10-21';

export const MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI
  'gpt-6-astra': { input: 10, cachedInput: 1, output: 50 },
  'gpt-6.1-sol': { input: 2, cachedInput: 0.1, output: 10 },
  'gpt-6-sol': { input: 2, cachedInput: 0.2, output: 10 },
  'gpt-6-luna': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'gpt-5.6-sol': { input: 4, cachedInput: 0.4, output: 20 },
  'gpt-5.6-terra': { input: 2, cachedInput: 0.2, output: 12 },
  'gpt-5.6-luna': { input: 0.2, cachedInput: 0.02, output: 1.2 },
  'gpt-5.5': { input: 5, cachedInput: 0.5, output: 30 },
  'gpt-5.4': { input: 2.5, cachedInput: 0.25, output: 15 },
  'gpt-5.4-mini': { input: 0.75, cachedInput: 0.075, output: 4.5 },
  'gpt-5.4-nano': { input: 0.2, cachedInput: 0.02, output: 1.25 },
  'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 },
  'gpt-4.1-mini': { input: 0.4, cachedInput: 0.1, output: 1.6 },
  // Anthropic (tabela de modelos atuais conferida em 2026-10-25; sem preço de cache publicado ali, o
  // cache conta como entrada cheia)
  'claude-fable-5-1': { input: 10, cachedInput: 0.25, output: 50 },
  'claude-mythos-5-1': { input: 10, cachedInput: 0.25, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, cachedInput: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cachedInput: 0.2, output: 10 },
  /** Prompts até 100 mil tokens (acima disso: 0,50/2,50). */
  'claude-haiku-5-5': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'claude-opus-5': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 2, cachedInput: 0.2, output: 10 },
  'claude-sonnet-4-6': { input: 3, cachedInput: 0.3, output: 15 },
  'claude-haiku-4-5': { input: 1, cachedInput: 0.1, output: 5 },
  // Gemini — preços até 31/12/2026 (o 3.8/3.6 Flash dobra em 01/01/2027; o 4 Argon em 01/12/2026)
  'gemini-4-argon': { input: 2, output: 10 },
  'gemini-3.8-flash': { input: 0.75, output: 3.75 },
  'gemini-3.6-flash': { input: 0.75, output: 3.75 },
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-pro-preview': { input: 2, output: 12 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
};

/** US$ por chamada da ferramenta de busca (US$ 10 por 1.000 na OpenAI e na Anthropic). */
export const WEB_SEARCH_USD_PER_CALL = 0.01;
/**
 * Grounding with Google Search nos modelos Gemini 3+: US$ 14 por 1.000 consultas (uma requisição pode
 * fazer várias). As 5.000 consultas grátis por mês ficam fora da estimativa (custo conservador).
 */
export const GEMINI_GROUNDING_USD_PER_QUERY = 0.014;

/** US$ por busca na web do provedor (o Gemini cobra por consulta do grounding; os demais por chamada). */
export function searchUsdFor(provider: string): number {
  return provider === 'gemini' ? GEMINI_GROUNDING_USD_PER_QUERY : WEB_SEARCH_USD_PER_CALL;
}

/** Preço do modelo (aceita snapshots datados, ex.: `gpt-6-luna-2026-05-18`). */
export function priceFor(model: string): ModelPrice | undefined {
  if (MODEL_PRICES[model]) return MODEL_PRICES[model];
  const base = Object.keys(MODEL_PRICES)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? MODEL_PRICES[base] : undefined;
}

/** Prefixo dos modelos de cada provedor na tabela de preços. */
const PROVIDER_MODEL_PREFIX: Record<string, string> = {
  openai: 'gpt-',
  anthropic: 'claude-',
  gemini: 'gemini-',
};

/** Provedor do modelo pelo nome (o da tabela); undefined fora dos três provedores. */
export function providerOfModel(model: string): string | undefined {
  return Object.entries(PROVIDER_MODEL_PREFIX).find(([, prefix]) => model.startsWith(prefix))?.[0];
}

/** Maior preço de entrada e de saída entre os modelos do provedor (sem desconto de cache). */
function highestPriceOf(provider: string): ModelPrice | undefined {
  const prefix = PROVIDER_MODEL_PREFIX[provider];
  const prices = Object.entries(MODEL_PRICES)
    .filter(([k]) => prefix && k.startsWith(prefix))
    .map(([, p]) => p);
  if (!prices.length) return undefined;
  return { input: Math.max(...prices.map((p) => p.input)), output: Math.max(...prices.map((p) => p.output)) };
}

const warnedUnpriced = new Set<string>();

/**
 * Preço para o orçamento: o da tabela ou, para modelo fora dela (ex.: `AI_MODEL_*` novo), o mais caro
 * do provedor — o teto em US$ não pode tratar o modelo desconhecido como de graça. O provedor vem do
 * parâmetro ou do prefixo do nome; sem provedor conhecido (cliente falso dos testes), undefined.
 */
export function budgetPriceFor(model: string, provider?: string): ModelPrice | undefined {
  const known = priceFor(model);
  if (known) return known;
  const family = provider && PROVIDER_MODEL_PREFIX[provider] ? provider : providerOfModel(model);
  const fallback = family ? highestPriceOf(family) : undefined;
  if (fallback && !warnedUnpriced.has(model)) {
    warnedUnpriced.add(model);
    console.warn(
      `[orçamento de IA] modelo ${model} fora da tabela de preços: o custo usa o preço mais caro do provedor ${family} (atualize MODEL_PRICES).`,
    );
  }
  return fallback;
}

/**
 * Custo estimado: tokens ao preço do modelo (fora da tabela, o mais caro do provedor; sem provedor
 * conhecido, tokens não entram) mais as buscas na web, que entram sempre.
 */
export function estimateCostUsd(
  model: string,
  usage: Pick<LlmUsage, 'inputTokens' | 'outputTokens'> & { cachedInputTokens?: number },
  webSearches = 0,
  usdPerSearch = WEB_SEARCH_USD_PER_CALL,
  provider?: string,
): number {
  const p = budgetPriceFor(model, provider);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const tokensCost = p
    ? ((usage.inputTokens - cached) * p.input +
        cached * (p.cachedInput ?? p.input) +
        usage.outputTokens * p.output) /
      1_000_000
    : 0;
  return Math.round((tokensCost + webSearches * usdPerSearch) * 1_000_000) / 1_000_000;
}
