/**
 * Preços dos modelos de IA para estimar custo (US$ por 1 milhão de tokens). A tabela mora em config/ai-pricing.yaml
 * (#1438), com a data da conferência de cada provedor e a vigência de cada preço; chega aqui pelo
 * `prices.generated.ts`. É uma ESTIMATIVA para orçamento e métricas — a fatura do provedor é a fonte da verdade.
 *
 * Os agentes (services/ai-agents), o ingestor e a Cosmos leem daqui. Para mudar um preço (ou incluir um modelo) sem
 * deploy: a flag AI_MODEL_PRICES em Ajustes (`modelo=entrada/cache/saída[/gravação]`), que vale por cima da tabela.
 */
import {
  AI_PROVIDER_MODEL_PREFIX,
  MODEL_PRICES_PATTERN,
  isAiProvider,
  providerOfModel,
} from '@galaxie/runtime-config';
import { PRICING_DATA } from './prices.generated.js';
import { pricesAt, pricingWarnings, type ModelPrice, type PricingWarning } from './pricing-data.js';

/**
 * Tokens de uma chamada (a entrada inclui os lidos e os gravados no cache; `cachedInputTokens` e
 * `cacheWriteTokens` os separam).
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
}

export type { ModelPrice } from './pricing-data.js';

/** Data mais antiga entre as conferências dos provedores (a tabela inteira foi conferida até ela). */
export const PRICES_CHECKED_AT = Object.values(PRICING_DATA.providers)
  .map((p) => p.checked_at)
  .sort()[0]!;

/** Tabela vigente no dia (a do yaml, sem AI_MODEL_PRICES). */
export const tablePricesAt = (at: Date = new Date()): Record<string, ModelPrice> =>
  pricesAt(PRICING_DATA, at);

/**
 * A tabela vigente quando o módulo carregou. Não segue o dia: em processo de vida longa (API, Cosmos) use
 * `effectiveModelPrices` ou `priceFor`, senão a mudança de preço de `from` não chega.
 * @deprecated para custo; serve a testes e a listagens.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = tablePricesAt();

/**
 * Avisos da tabela no dia (conferência velha, preço que muda em breve, modelo em uso sem preço). `overrides`: o
 * AI_MODEL_PRICES efetivo de quem chama (ex.: o painel, que resolve pelo banco); ausente = o do ambiente.
 */
export function modelPricingWarnings(
  inUse: readonly string[] = [],
  at: Date = new Date(),
  overrides?: string | null,
): PricingWarning[] {
  const over = overrides === undefined ? modelPriceOverrides() : parseModelPrices(overrides);
  return pricingWarnings(
    PRICING_DATA,
    at,
    inUse,
    { ...tablePricesAt(at), ...over },
    new Set(Object.keys(over)),
  );
}

/** Data da conferência da tabela de cada provedor (config/ai-pricing.yaml). */
export const PRICES_CHECKED_BY_PROVIDER: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PRICING_DATA.providers).map(([p, info]) => [p, info.checked_at]),
);

export { describePricingWarning, type PricingWarning } from './pricing-data.js';

/** Anthropic: gravar no cache custa o múltiplo da entrada do yaml (para AI_MODEL_PRICES sem o quarto campo). */
function withAnthropicCacheWrite(model: string, price: ModelPrice): ModelPrice {
  if (model.startsWith('claude-') && price.cacheWrite === undefined)
    price.cacheWrite =
      Math.round(price.input * PRICING_DATA.anthropic_cache_write_multiplier * 1_000_000) / 1_000_000;
  return price;
}

/**
 * AI_MODEL_PRICES: `modelo=entrada/cache/saída[/gravação]` separados por vírgula, ponto e vírgula ou
 * espaço (US$ por 1 milhão de tokens; `cache` e `gravação` podem ficar vazios: valem o preço da entrada, e a
 * gravação dos modelos `claude-*`, o múltiplo do yaml sobre a entrada). Padrão único no registro (@galaxie/runtime-config).
 * Ex.: `deepseek-flash=0.15/0.003/0.6, gpt-6-luna=0.1/0.01/0.5`.
 */
export { MODEL_PRICES_PATTERN };

/** Lê AI_MODEL_PRICES. Vazio: {}; formato inválido: erro com a entrada. */
export function parseModelPrices(raw: string | null | undefined): Record<string, ModelPrice> {
  const out: Record<string, ModelPrice> = {};
  const text = raw?.trim();
  if (!text) return out;
  if (!MODEL_PRICES_PATTERN.test(text))
    throw new Error(
      `AI_MODEL_PRICES inválido: use modelo=entrada/cache/saída[/gravação] (recebido: ${text}).`,
    );
  for (const entry of text.split(/[,;\s]+/).filter(Boolean)) {
    const [model, values] = entry.split('=') as [string, string];
    const [input, cached, output, write] = values.split('/');
    out[model] = withAnthropicCacheWrite(model, {
      input: Number(input),
      output: Number(output),
      ...(cached ? { cachedInput: Number(cached) } : {}),
      ...(write ? { cacheWrite: Number(write) } : {}),
    });
  }
  return out;
}

let overrides: Record<string, ModelPrice> | undefined;

/**
 * Preços que valem por cima da tabela. Sem chamada a `setModelPriceOverrides`, lê AI_MODEL_PRICES do
 * ambiente na primeira consulta (os jobs são processos novos a cada execução, com o env atualizado);
 * valor inválido no ambiente sai no log e é ignorado (a tabela do código vale).
 */
export function modelPriceOverrides(): Readonly<Record<string, ModelPrice>> {
  if (overrides === undefined) {
    try {
      overrides = parseModelPrices(process.env.AI_MODEL_PRICES);
    } catch (err) {
      console.warn(
        `[preços de IA] ${err instanceof Error ? err.message : String(err)} A tabela do código vale.`,
      );
      overrides = {};
    }
  }
  return overrides;
}

/**
 * Troca os preços por cima da tabela (processo de vida longa que resolve AI_MODEL_PRICES pelo banco, ex.:
 * a API da Cosmos). Texto no formato da flag, mapa pronto ou null (volta a ler o ambiente).
 */
export function setModelPriceOverrides(value: string | Record<string, ModelPrice> | null): void {
  overrides = value === null ? undefined : typeof value === 'string' ? parseModelPrices(value) : { ...value };
}

/** A tabela vigente no dia com os preços de AI_MODEL_PRICES por cima. */
export function effectiveModelPrices(at: Date = new Date()): Record<string, ModelPrice> {
  return { ...tablePricesAt(at), ...modelPriceOverrides() };
}

/** US$ por chamada da ferramenta de busca (OpenAI e Anthropic; config/ai-pricing.yaml). */
export const WEB_SEARCH_USD_PER_CALL = PRICING_DATA.search.web_search_usd_per_call;
/**
 * Grounding with Google Search nos modelos Gemini 3+: US$ 14 por 1.000 consultas (uma requisição pode
 * fazer várias). As 5.000 consultas grátis por mês ficam fora da estimativa (custo conservador).
 */
export const GEMINI_GROUNDING_USD_PER_QUERY = PRICING_DATA.search.gemini_grounding_usd_per_query;

/** US$ por busca na web do provedor (o Gemini cobra por consulta do grounding; os demais por chamada). */
export function searchUsdFor(provider: string): number {
  return provider === 'gemini' ? GEMINI_GROUNDING_USD_PER_QUERY : WEB_SEARCH_USD_PER_CALL;
}

/** Preço do modelo (aceita snapshots datados, ex.: `gpt-6-luna-2026-05-18`). */
export function priceFor(model: string): ModelPrice | undefined {
  const prices = effectiveModelPrices();
  if (prices[model]) return prices[model];
  const base = Object.keys(prices)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? prices[base] : undefined;
}

/** Provedor do modelo pelo prefixo do nome (catálogo único, @galaxie/runtime-config); undefined fora dos conhecidos. */
export { providerOfModel };

/** Maior preço de entrada e de saída entre os modelos do provedor (sem desconto de cache). */
function highestPriceOf(provider: string): ModelPrice | undefined {
  const prefix = isAiProvider(provider) ? AI_PROVIDER_MODEL_PREFIX[provider] : undefined;
  const prices = Object.entries(effectiveModelPrices())
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
  const family = provider && isAiProvider(provider) ? provider : providerOfModel(model);
  const fallback = family ? highestPriceOf(family) : undefined;
  if (fallback && !warnedUnpriced.has(model)) {
    warnedUnpriced.add(model);
    console.warn(
      `[orçamento de IA] modelo ${model} fora da tabela de preços: o custo usa o preço mais caro do provedor ${family} (atualize config/ai-pricing.yaml).`,
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
  usage: TokenUsage,
  webSearches = 0,
  usdPerSearch = WEB_SEARCH_USD_PER_CALL,
  provider?: string,
): number {
  const p = budgetPriceFor(model, provider);
  const cached = Math.min(usage.cachedInputTokens ?? 0, usage.inputTokens);
  const written = Math.min(usage.cacheWriteTokens ?? 0, usage.inputTokens - cached);
  const tokensCost = p
    ? ((usage.inputTokens - cached - written) * p.input +
        cached * (p.cachedInput ?? p.input) +
        written * (p.cacheWrite ?? p.input) +
        usage.outputTokens * p.output) /
      1_000_000
    : 0;
  return Math.round((tokensCost + webSearches * usdPerSearch) * 1_000_000) / 1_000_000;
}
