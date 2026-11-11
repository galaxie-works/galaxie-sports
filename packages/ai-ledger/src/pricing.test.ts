import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MODEL_PRICES,
  MODEL_PRICES_PATTERN,
  budgetPriceFor,
  estimateCostUsd,
  modelPriceOverrides,
  parseModelPrices,
  priceFor,
  providerOfModel,
  setModelPriceOverrides,
} from './pricing.js';

afterEach(() => {
  setModelPriceOverrides(null);
  vi.unstubAllEnvs();
});

describe('tabela de preços', () => {
  it('DeepSeek na tabela, com o prefixo do provedor', () => {
    expect(priceFor('deepseek-flash')).toEqual({ input: 0.3, cachedInput: 0.006, output: 1.2 });
    expect(priceFor('deepseek-v4-pro')).toBeDefined();
    expect(providerOfModel('deepseek-flash')).toBe('deepseek');
  });

  it('modelo DeepSeek fora da tabela: o preço mais caro do provedor (o teto em US$ conta)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(budgetPriceFor('deepseek-chat', 'deepseek')).toEqual({ input: 1.32, output: 3.96 });
    expect(
      estimateCostUsd('deepseek-chat', { inputTokens: 1_000_000, outputTokens: 0 }, 0, 0, 'deepseek'),
    ).toBe(1.32);
    warn.mockRestore();
  });

  it('gravação no cache: Anthropic a 1,25× a entrada; sem cacheWriteTokens, a conta de antes', () => {
    expect(MODEL_PRICES['claude-haiku-4-5']!.cacheWrite).toBe(1.25);
    const base = { inputTokens: 1_000, outputTokens: 0, cachedInputTokens: 200 };
    expect(estimateCostUsd('claude-haiku-4-5', base)).toBeCloseTo((800 * 1 + 200 * 0.1) / 1e6, 9);
    expect(estimateCostUsd('claude-haiku-4-5', { ...base, cacheWriteTokens: 300 })).toBeCloseTo(
      (500 * 1 + 200 * 0.1 + 300 * 1.25) / 1e6,
      9,
    );
    // quem não cobra gravação: preço da entrada
    expect(
      estimateCostUsd('deepseek-flash', { inputTokens: 1_000, outputTokens: 0, cacheWriteTokens: 1_000 }),
    ).toBe(estimateCostUsd('deepseek-flash', { inputTokens: 1_000, outputTokens: 0 }));
  });
});

describe('AI_MODEL_PRICES (preço por cima da tabela, sem deploy)', () => {
  it('lê modelo=entrada/cache/saída[/gravação]; cache e gravação opcionais', () => {
    expect(
      parseModelPrices('deepseek-flash=0.15/0.003/0.6, novo-modelo=1//2;claude-x=3/0.3/15/3.75'),
    ).toEqual({
      'deepseek-flash': { input: 0.15, cachedInput: 0.003, output: 0.6 },
      'novo-modelo': { input: 1, output: 2 },
      'claude-x': { input: 3, cachedInput: 0.3, output: 15, cacheWrite: 3.75 },
    });
    expect(parseModelPrices('')).toEqual({});
    expect(() => parseModelPrices('deepseek-flash=0.15')).toThrow(/AI_MODEL_PRICES/);
    expect(MODEL_PRICES_PATTERN.test('a=1/2')).toBe(false);
  });

  it('vale por cima da tabela e entra no preço do provedor desconhecido', () => {
    setModelPriceOverrides('deepseek-flash=1/0.5/2, deepseek-novo=10//20');
    expect(priceFor('deepseek-flash')).toEqual({ input: 1, cachedInput: 0.5, output: 2 });
    expect(priceFor('deepseek-flash-2026-12-01')).toEqual({ input: 1, cachedInput: 0.5, output: 2 });
    expect(budgetPriceFor('deepseek-outro', 'deepseek')).toEqual({ input: 10, output: 20 });
    setModelPriceOverrides(null);
    vi.stubEnv('AI_MODEL_PRICES', '');
    expect(priceFor('deepseek-flash')).toEqual(MODEL_PRICES['deepseek-flash']);
  });

  it('lê do ambiente na primeira consulta; valor inválido no ambiente é ignorado com aviso', () => {
    vi.stubEnv('AI_MODEL_PRICES', 'gpt-6-luna=9/9/9');
    setModelPriceOverrides(null);
    expect(priceFor('gpt-6-luna')).toEqual({ input: 9, cachedInput: 9, output: 9 });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubEnv('AI_MODEL_PRICES', 'lixo');
    setModelPriceOverrides(null);
    expect(modelPriceOverrides()).toEqual({});
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
