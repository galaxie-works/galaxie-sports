import { describe, expect, it } from 'vitest';
import { VAR_OUTCOMES } from './events.js';
import {
  NARRATION_CATALOG,
  NARRATION_KEYS,
  NARRATION_LANGS,
  cleanNarrationVariants,
  validateNarration,
} from './narration.js';

describe('catálogo das frases do lance a lance (#1167)', () => {
  it('todo veredito do VAR tem frase', () => {
    for (const o of VAR_OUTCOMES) expect(NARRATION_KEYS).toContain(`var.${o}`);
  });

  it('cada padrão tem os três idiomas e só usa os marcadores da chave', () => {
    for (const key of NARRATION_KEYS)
      for (const lang of NARRATION_LANGS) {
        const variants = NARRATION_CATALOG[key].defaults[lang];
        expect(variants.length, `${key}/${lang}`).toBeGreaterThan(0);
        expect(validateNarration(key, variants), `${key}/${lang}`).toEqual([]);
      }
  });
});

describe('validação da edição em Ajustes', () => {
  it('recusa vazio, marcador desconhecido, chave quebrada e frase longa', () => {
    expect(validateNarration('goal.opener', ['  '])).toEqual([{ code: 'empty' }]);
    expect(validateNarration('goal.opener', ['{jogador} abre o placar'])).toEqual([
      { code: 'unknown_placeholder', variant: 0, placeholder: 'jogador' },
    ]);
    expect(validateNarration('goal.opener', ['{player abre o placar'])).toEqual([
      { code: 'broken_placeholder', variant: 0 },
    ]);
    expect(validateNarration('goal.opener', ['x'.repeat(241)])).toEqual([{ code: 'too_long', variant: 0 }]);
    expect(
      validateNarration(
        'goal.opener',
        Array.from({ length: 9 }, () => 'a'),
      ),
    ).toEqual([{ code: 'too_many' }]);
    expect(validateNarration('goal.opener', ['Que gol de {player}', '{player} abre o placar'])).toEqual([]);
  });

  it('limpa espaços e linhas vazias', () => {
    expect(cleanNarrationVariants(['  Gol   de {player} ', '', ' '])).toEqual(['Gol de {player}']);
  });
});
