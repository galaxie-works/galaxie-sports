import { describe, expect, it } from 'vitest';

import { marginUsd } from './staff-data-utils';

describe('margem das carteiras', () => {
  it('dólar direto, reais pela cotação, menos o custo real', () => {
    expect(marginUsd({ revenueCents: { brl: 0, usd: 2900 }, costUsd: 1.25 }, null)).toBe(27.75);
    expect(marginUsd({ revenueCents: { brl: 5000, usd: 0 }, costUsd: 1 }, 5)).toBe(9);
    expect(marginUsd({ revenueCents: { brl: 0, usd: 0 }, costUsd: 0.4 }, null)).toBe(-0.4);
  });

  it('receita em reais sem cotação: sem valor, para não mostrar número pela metade', () => {
    expect(marginUsd({ revenueCents: { brl: 5000, usd: 100 }, costUsd: 0 }, null)).toBeNull();
  });
});
