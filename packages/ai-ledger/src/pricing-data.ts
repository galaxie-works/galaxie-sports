/**
 * Tabela de preços de config/ai-pricing.yaml (#1438): forma, validação, vigência por data e avisos de vencimento.
 * Sem leitura de arquivo: o yaml chega pelo `prices.generated.ts` (gerado por scripts/gen-prices.mjs), e o painel e o
 * app Next importam sem tocar no disco.
 */

/** US$ por 1 milhão de tokens. */
export interface ModelPrice {
  input: number;
  /** Entrada lida do cache (ausente: o preço da entrada). */
  cachedInput?: number;
  output: number;
  /** Entrada gravada no cache (ausente: o preço da entrada). */
  cacheWrite?: number;
}

export interface PricingRow {
  model: string;
  /** Dia UTC (AAAA-MM-DD, inclusivo) em que o preço passa a valer; ausente = desde sempre. */
  from?: string;
  input: number;
  cached_input?: number;
  output: number;
  cache_write?: number;
}

export interface PricingData {
  schema_version: number;
  providers: Record<string, { checked_at: string; source: string }>;
  search: { web_search_usd_per_call: number; gemini_grounding_usd_per_query: number };
  anthropic_cache_write_multiplier: number;
  models: PricingRow[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const price = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

/** Erros de forma da tabela (vazio = válida). */
export function pricingDataErrors(data: PricingData): string[] {
  const errors: string[] = [];
  if (data.schema_version !== 1) errors.push(`schema_version ${String(data.schema_version)} (esperado 1)`);
  for (const [p, info] of Object.entries(data.providers ?? {}))
    if (!DAY.test(String(info?.checked_at))) errors.push(`providers.${p}.checked_at precisa ser AAAA-MM-DD`);
  if (!price(data.search?.web_search_usd_per_call)) errors.push('search.web_search_usd_per_call inválido');
  if (!price(data.search?.gemini_grounding_usd_per_query))
    errors.push('search.gemini_grounding_usd_per_query inválido');
  if (!price(data.anthropic_cache_write_multiplier)) errors.push('anthropic_cache_write_multiplier inválido');
  const seen = new Set<string>();
  for (const row of data.models ?? []) {
    const id = `${row.model}@${row.from ?? 'sempre'}`;
    if (seen.has(id)) errors.push(`${id} repetido`);
    seen.add(id);
    if (row.from !== undefined && !DAY.test(row.from)) errors.push(`${id}: from precisa ser AAAA-MM-DD`);
    for (const k of ['input', 'output'] as const) if (!price(row[k])) errors.push(`${id}: ${k} inválido`);
    for (const k of ['cached_input', 'cache_write'] as const)
      if (row[k] !== undefined && !price(row[k])) errors.push(`${id}: ${k} inválido`);
  }
  for (const model of new Set((data.models ?? []).map((r) => r.model)))
    if (!(data.models ?? []).some((r) => r.model === model && r.from === undefined))
      errors.push(`${model}: falta a linha sem from (o preço de hoje)`);
  return errors;
}

/** Dia UTC (AAAA-MM-DD) de uma data. */
export const utcDay = (at: Date): string => at.toISOString().slice(0, 10);

function toPrice(row: PricingRow, cacheWriteMultiplier: number): ModelPrice {
  const p: ModelPrice = { input: row.input, output: row.output };
  if (row.cached_input !== undefined) p.cachedInput = row.cached_input;
  if (row.cache_write !== undefined) p.cacheWrite = row.cache_write;
  else if (row.model.startsWith('claude-'))
    p.cacheWrite = Math.round(row.input * cacheWriteMultiplier * 1_000_000) / 1_000_000;
  return p;
}

/** Preço de cada modelo no dia: a linha de `from` mais recente que já começou (a sem `from` vale desde sempre). */
export function pricesAt(data: PricingData, at: Date): Record<string, ModelPrice> {
  const day = utcDay(at);
  const chosen = new Map<string, PricingRow>();
  for (const row of data.models) {
    if (row.from !== undefined && row.from > day) continue;
    const current = chosen.get(row.model);
    if (!current || (row.from ?? '') > (current.from ?? '')) chosen.set(row.model, row);
  }
  return Object.fromEntries(
    [...chosen].map(([model, row]) => [model, toPrice(row, data.anthropic_cache_write_multiplier)]),
  );
}

/** Tabela com mais de tantos dias sem conferência gera aviso. */
export const PRICES_STALE_DAYS = 60;
/** Mudança de preço a menos de tantos dias gera aviso. */
export const PRICE_CHANGE_NOTICE_DAYS = 30;

export type PricingWarning =
  | { kind: 'stale'; provider: string; checkedAt: string; days: number }
  | { kind: 'change'; model: string; from: string; days: number; price: ModelPrice }
  | { kind: 'unpriced'; model: string };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/**
 * Avisos da tabela no dia: provedor sem conferência há mais de PRICES_STALE_DAYS, preço que muda nos próximos
 * PRICE_CHANGE_NOTICE_DAYS e modelo em uso (`inUse`) sem preço próprio em `prices` (a tabela com AI_MODEL_PRICES por
 * cima; nome com prefixo `modelo-` da tabela conta como o modelo, como no custo). `overridden`: modelos com preço
 * em AI_MODEL_PRICES, cuja mudança da tabela não chega (sem aviso de mudança).
 */
export function pricingWarnings(
  data: PricingData,
  at: Date,
  inUse: readonly string[] = [],
  prices: Record<string, ModelPrice> = pricesAt(data, at),
  overridden: ReadonlySet<string> = new Set(),
): PricingWarning[] {
  const day = utcDay(at);
  const out: PricingWarning[] = [];
  for (const [provider, info] of Object.entries(data.providers)) {
    const days = daysBetween(info.checked_at, day);
    if (days > PRICES_STALE_DAYS) out.push({ kind: 'stale', provider, checkedAt: info.checked_at, days });
  }
  for (const row of data.models) {
    if (row.from === undefined || row.from <= day) continue;
    // preço do modelo fixado por AI_MODEL_PRICES (`overridden`): a mudança da tabela não chega, então não avisa
    if (overridden.has(row.model)) continue;
    const days = daysBetween(day, row.from);
    if (days <= PRICE_CHANGE_NOTICE_DAYS)
      out.push({
        kind: 'change',
        model: row.model,
        from: row.from,
        days,
        price: toPrice(row, data.anthropic_cache_write_multiplier),
      });
  }
  // mesmo critério do custo (`priceFor`): o nome exato ou um prefixo `modelo-` da tabela
  const priced = (model: string) =>
    Boolean(prices[model]) || Object.keys(prices).some((k) => model.startsWith(`${k}-`));
  for (const model of new Set(inUse.map((m) => m.trim()).filter(Boolean)))
    if (!priced(model)) out.push({ kind: 'unpriced', model });
  return out;
}

/** Aviso em uma linha, em português, para o log. */
export function describePricingWarning(w: PricingWarning): string {
  switch (w.kind) {
    case 'stale':
      return `preços de ${w.provider} conferidos em ${w.checkedAt} (${w.days} dias): confira a página oficial e atualize config/ai-pricing.yaml`;
    case 'change':
      return `preço de ${w.model} muda em ${w.from} (daqui a ${w.days} dias): ${w.price.input}/${w.price.output} por 1M tokens`;
    case 'unpriced':
      return `modelo ${w.model} em uso sem preço próprio: o orçamento usa o mais caro do provedor (inclua em config/ai-pricing.yaml ou AI_MODEL_PRICES)`;
  }
}
