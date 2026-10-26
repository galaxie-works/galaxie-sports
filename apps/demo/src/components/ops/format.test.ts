import { describe, expect, it } from 'vitest';
import { validateSettingKey } from '@galaxie/runtime-config';

import { getDictionary } from '@/lib/i18n/dictionary';
import { validationMessage } from '@/lib/ops/validation-message';

import { aiStateText, tokenUsage } from './format';

const pt = getDictionary('pt-BR').ops;

describe('estado literal da IA no painel', () => {
  it('desligado · sem limite · limitado com os tetos que existem', () => {
    expect(aiStateText(pt, 'pt-BR', { status: 'off', usdPerDay: 10 })).toBe('desligado');
    expect(aiStateText(pt, 'pt-BR', { status: 'on', usdPerDay: null, tokensPerDay: null })).toBe(
      'ligado · sem limite',
    );
    expect(aiStateText(pt, 'pt-BR', { status: 'on', usdPerDay: 10, tokensPerDay: 2_000_000 })).toBe(
      'ligado · limitado · US$ 10/dia · 2.000.000 tokens/dia',
    );
    expect(aiStateText(getDictionary('en').ops, 'en', { status: 'on', usdPerDay: 10 })).toBe(
      'on · limited · US$ 10/day',
    );
  });

  it('0 num teto: a mensagem diz como desligar', () => {
    const checked = validateSettingKey('AI_DAILY_USD_BUDGET', '0');
    expect(checked.ok).toBe(false);
    if (!checked.ok) expect(validationMessage(pt, checked.error)).toMatch(/use AI_STATUS=off/);
  });
});

describe('tokens do dia no painel', () => {
  it('o pool próprio do assets fica fora da soma contra o teto global e aparece à parte', () => {
    const byAgent = [
      { agent: 'wtw', inputTokens: 900_000, outputTokens: 100_000 },
      { agent: 'assets', inputTokens: 550_000, outputTokens: 50_000 },
    ];
    expect(tokenUsage(byAgent, 3_000_000)).toEqual({
      counted: 1_000_000,
      pools: [{ agent: 'assets', used: 600_000, limit: 600_000 }],
    });
    expect(tokenUsage(byAgent, null).pools[0]!.limit).toBeNull();
  });
});
