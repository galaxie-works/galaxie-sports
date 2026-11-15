import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_AGENT_TIERS, effectiveTiers, moduleTiers, tierCondition, tiersUpTo } from './tiers.js';

describe('tiers dos agentes', () => {
  it('padrão: tier ≤ 2, como antes do painel', () => {
    expect(DEFAULT_AGENT_TIERS).toEqual([1, 2]);
    expect(tiersUpTo(1)).toEqual([1]);
    expect(tiersUpTo(5)).toEqual([1, 2, 3]);
  });

  it('a opção --tier da CLI vale por cima do módulo do painel', () => {
    expect(effectiveTiers({})).toEqual([1, 2]);
    expect(effectiveTiers({ tiers: [1] })).toEqual([1]);
    expect(effectiveTiers({ tiers: [1], maxTier: 3 })).toEqual([1, 2, 3]);
  });

  it('lê o módulo do env (MODULES_FOOTBALL); valor inválido = padrão', () => {
    expect(moduleTiers({ MODULES_FOOTBALL: 'ai-content=on,off,off' }, 'ai-content')).toEqual([1]);
    expect(moduleTiers({ MODULES_FOOTBALL: 'wtw=on' }, 'wtw')).toEqual([1, 2, 3]);
    expect(moduleTiers({ MODULES_FOOTBALL: 'wtw=talvez' }, 'wtw')).toEqual([1, 2]);
    expect(moduleTiers({}, 'ai-content')).toEqual([1, 2]);
  });

  it('condição SQL: tier 1 cobre o 0, tier 3 cobre 3 e acima, nenhum tier = nada', () => {
    const text = (tiers: number[]) => new PgDialect().sqlToQuery(tierCondition(tiers)).sql;
    expect(text([])).toBe('false');
    expect(text([1])).toContain('"tier" <= $1');
    expect(text([2])).toContain('"tier" = $1');
    expect(text([3])).toContain('"tier" >= $1');
    expect(text([1, 3])).toContain(' or ');
    expect(text([1, 3])).not.toContain(' = ');
  });
});
