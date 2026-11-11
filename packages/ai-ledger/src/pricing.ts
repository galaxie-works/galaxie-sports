/**
 * Tabela de preços para estimar custo (USD por 1 milhão de tokens, tier padrão, contexto curto).
 * Fontes oficiais conferidas em 2026-10-21:
 * - https://developers.openai.com/api/docs/pricing
 * - https://platform.claude.com/docs/en/about-claude/pricing (Anthropic, modelos atuais conferidos em 2026-10-25)
 * - https://ai.google.dev/gemini-api/docs/pricing (Gemini, conferida em 2026-10-23)
 * - https://api-docs.deepseek.com/quick_start/pricing (DeepSeek, conferida em 2026-11-11)
 * É uma ESTIMATIVA para orçamento e métricas — a fatura do provedor é a fonte da verdade.
 *
 * É o único lugar com preço por token: os agentes (services/ai-agents), o ingestor e a Cosmos leem daqui.
 * Para mudar um preço (ou incluir um modelo) sem deploy: a flag AI_MODEL_PRICES em Ajustes
 * (`modelo=entrada/cache/saída[/gravação]`, US$ por 1 milhão de tokens), que vale por cima desta tabela.
 */
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

/** US$ por 1 milhão de tokens. */
export interface ModelPrice {
  input: number;
  /** Entrada lida do cache (ausente: o preço da entrada). */
  cachedInput?: number;
  output: number;
  /** Entrada gravada no cache (ausente: o preço da entrada). */
  cacheWrite?: number;
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
  // Anthropic (modelos atuais conferidos em 2026-10-25). Leitura de cache: Fable 5.1 e Mythos 5.1
  // 0,025× da entrada, Opus 5.5 0,05×, Fable 5 US$ 1, os demais 0,1×. Mythos 5.1: só Project Glasswing.
  'claude-fable-5-1': { input: 10, cachedInput: 0.25, output: 50 },
  'claude-mythos-5-1': { input: 10, cachedInput: 0.25, output: 50 },
  'claude-fable-5': { input: 10, cachedInput: 1, output: 50 },
  'claude-opus-5-5': { input: 4, cachedInput: 0.2, output: 20 },
  'claude-sonnet-5-5': { input: 2, cachedInput: 0.2, output: 10 },
  /** Prompts até 100 mil tokens (acima disso: 0,50/2,50). */
  'claude-haiku-5-5': { input: 0.1, cachedInput: 0.01, output: 0.5 },
  'claude-opus-5': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-opus-4-8': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-opus-4-7': { input: 5, cachedInput: 0.5, output: 25 },
  'claude-opus-4-6': { input: 5, cachedInput: 0.5, output: 25 },
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
  // DeepSeek (API compatível com a da OpenAI). Preço do horário de pico (01:00–04:00 e 06:00–10:00 UTC, dias
  // úteis), o dobro do fora de pico: o teto do dia fica do lado seguro. `deepseek-chat` e `deepseek-reasoner`
  // não aparecem mais na página de preços: fora da tabela, valem pelo preço mais caro do provedor.
  'deepseek-flash': { input: 0.3, cachedInput: 0.006, output: 1.2 },
  'deepseek-v4-pro': { input: 1.32, cachedInput: 0.044, output: 3.96 },
};

/**
 * Anthropic: gravar no cache (TTL de 5 min) custa 1,25× a entrada; os demais não cobram à parte. Vale para a tabela
 * do código e para os preços de AI_MODEL_PRICES sem o quarto campo.
 */
function withAnthropicCacheWrite(model: string, price: ModelPrice): ModelPrice {
  if (model.startsWith('claude-') && price.cacheWrite === undefined)
    price.cacheWrite = Math.round(price.input * 1.25 * 1_000_000) / 1_000_000;
  return price;
}
for (const [model, price] of Object.entries(MODEL_PRICES)) withAnthropicCacheWrite(model, price);

/**
 * AI_MODEL_PRICES: `modelo=entrada/cache/saída[/gravação]` separados por vírgula, ponto e vírgula ou
 * espaço (US$ por 1 milhão de tokens; `cache` e `gravação` podem ficar vazios: valem o preço da entrada, e a
 * gravação dos modelos `claude-*`, 1,25× a entrada).
 * Ex.: `deepseek-flash=0.15/0.003/0.6, gpt-6-luna=0.1/0.01/0.5`.
 */
const PRICE_NUM = '\\d+(?:\\.\\d+)?';
const PRICE_ENTRY = `[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,80}=${PRICE_NUM}/(?:${PRICE_NUM})?/${PRICE_NUM}(?:/(?:${PRICE_NUM})?)?`;
export const MODEL_PRICES_PATTERN = new RegExp(`^${PRICE_ENTRY}(?:[,;\\s]+${PRICE_ENTRY})*$`);

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

/** A tabela do código com os preços de AI_MODEL_PRICES por cima. */
export function effectiveModelPrices(): Record<string, ModelPrice> {
  return { ...MODEL_PRICES, ...modelPriceOverrides() };
}

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
  const prices = effectiveModelPrices();
  if (prices[model]) return prices[model];
  const base = Object.keys(prices)
    .filter((k) => model.startsWith(`${k}-`))
    .sort((a, b) => b.length - a.length)[0];
  return base ? prices[base] : undefined;
}

/** Prefixo dos modelos de cada provedor na tabela de preços. */
const PROVIDER_MODEL_PREFIX: Record<string, string> = {
  openai: 'gpt-',
  anthropic: 'claude-',
  gemini: 'gemini-',
  deepseek: 'deepseek-',
};

/** Provedor do modelo pelo nome (o da tabela); undefined fora dos provedores conhecidos. */
export function providerOfModel(model: string): string | undefined {
  return Object.entries(PROVIDER_MODEL_PREFIX).find(([, prefix]) => model.startsWith(prefix))?.[0];
}

/** Maior preço de entrada e de saída entre os modelos do provedor (sem desconto de cache). */
function highestPriceOf(provider: string): ModelPrice | undefined {
  const prefix = PROVIDER_MODEL_PREFIX[provider];
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
