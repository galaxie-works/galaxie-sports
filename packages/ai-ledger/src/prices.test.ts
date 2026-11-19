/** Tabela de preços de config/ai-pricing.yaml (#1438): gerado em dia, válida, vigência por data e avisos. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { PRICING_DATA } from './prices.generated.js';
import { pricesAt, pricingDataErrors, pricingWarnings, type PricingData } from './pricing-data.js';
import { effectiveModelPrices, GEMINI_GROUNDING_USD_PER_QUERY, WEB_SEARCH_USD_PER_CALL } from './pricing.js';

const YAML = fileURLToPath(new URL('../../../config/ai-pricing.yaml', import.meta.url));
const at = (day: string) => new Date(`${day}T12:00:00Z`);

describe('config/ai-pricing.yaml', () => {
  it('o gerado é o yaml (rode pnpm --filter @galaxie/ai-ledger gen:prices)', () => {
    expect(PRICING_DATA).toEqual(parse(readFileSync(YAML, 'utf8')));
  });

  it('é válido', () => {
    expect(pricingDataErrors(PRICING_DATA)).toEqual([]);
  });

  it('custos de busca saem do yaml', () => {
    expect(WEB_SEARCH_USD_PER_CALL).toBe(PRICING_DATA.search.web_search_usd_per_call);
    expect(GEMINI_GROUNDING_USD_PER_QUERY).toBe(PRICING_DATA.search.gemini_grounding_usd_per_query);
  });
});

describe('vigência', () => {
  it('o Gemini 4 Argon dobra em 01/12/2026 e o 3.8 Flash em 01/01/2027, sem deploy', () => {
    expect(pricesAt(PRICING_DATA, at('2026-11-30'))['gemini-4-argon']).toMatchObject({
      input: 2,
      output: 10,
    });
    expect(pricesAt(PRICING_DATA, at('2026-12-01'))['gemini-4-argon']).toMatchObject({
      input: 4,
      output: 20,
    });
    expect(pricesAt(PRICING_DATA, at('2026-12-31'))['gemini-3.8-flash']).toMatchObject({ input: 0.75 });
    expect(pricesAt(PRICING_DATA, at('2027-01-01'))['gemini-3.8-flash']).toMatchObject({
      input: 1.5,
      output: 7.5,
    });
    expect(effectiveModelPrices(at('2027-01-02'))['gemini-3.8-flash']!.input).toBe(1.5);
  });

  it('Anthropic sem cache_write grava a 1,25× da entrada', () => {
    expect(pricesAt(PRICING_DATA, at('2026-11-19'))['claude-haiku-4-5']!.cacheWrite).toBe(1.25);
  });

  it('acusa linha repetida, data inválida e modelo só com preço futuro', () => {
    const bad: PricingData = {
      ...PRICING_DATA,
      models: [
        { model: 'x-1', input: 1, output: 1 },
        { model: 'x-1', input: 2, output: 2 },
        { model: 'x-2', from: '01/12/2026', input: 1, output: 1 },
      ],
    };
    const errors = pricingDataErrors(bad).join('\n');
    expect(errors).toMatch(/x-1@sempre repetido/);
    expect(errors).toMatch(/x-2@01\/12\/2026: from/);
    expect(errors).toMatch(/x-2: falta a linha sem from/);
  });
});

describe('avisos', () => {
  const data: PricingData = {
    ...PRICING_DATA,
    providers: {
      openai: { checked_at: '2026-09-01', source: 'x' },
      gemini: { checked_at: '2026-11-19', source: 'y' },
    },
  };

  it('conferência com mais de 60 dias, mudança nos próximos 30 e modelo em uso sem preço', () => {
    const w = pricingWarnings(data, at('2026-11-19'), [
      'gemini-3.8-flash',
      'gpt-9-novo',
      'gpt-6-luna-2026-05-18',
    ]);
    expect(w).toContainEqual({ kind: 'stale', provider: 'openai', checkedAt: '2026-09-01', days: 79 });
    expect(w.some((x) => x.kind === 'stale' && x.provider === 'gemini')).toBe(false);
    expect(w).toContainEqual(
      expect.objectContaining({ kind: 'change', model: 'gemini-4-argon', from: '2026-12-01', days: 12 }),
    );
    expect(w.some((x) => x.kind === 'change' && x.model === 'gemini-3.8-flash')).toBe(false);
    expect(w).toContainEqual({ kind: 'unpriced', model: 'gpt-9-novo' });
    expect(w.some((x) => x.kind === 'unpriced' && x.model === 'gpt-6-luna-2026-05-18')).toBe(false);
  });
});

describe('avisos com AI_MODEL_PRICES e prefixo', () => {
  it('modelo com sufixo da tabela conta como precificado, como no custo', () => {
    const w = pricingWarnings(PRICING_DATA, at('2026-11-19'), ['gemini-3.8-flash-preview']);
    expect(w.some((x) => x.kind === 'unpriced')).toBe(false);
  });

  it('preço fixado por AI_MODEL_PRICES não recebe aviso de mudança', () => {
    const w = pricingWarnings(PRICING_DATA, at('2026-11-19'), [], undefined, new Set(['gemini-4-argon']));
    expect(w.some((x) => x.kind === 'change' && x.model === 'gemini-4-argon')).toBe(false);
  });
});
