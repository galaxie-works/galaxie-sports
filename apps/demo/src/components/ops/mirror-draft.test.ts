import { validateSettingKey } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import { draftState, initialDraft } from './mirror-draft';

describe('rascunho dos períodos do espelho', () => {
  it('parte do valor efetivo e grava só o que difere do padrão', () => {
    const draft = initialDraft('football', '/venues=60');
    expect(draft['/venues']).toEqual([{ on: true, days: '60' }]);
    expect(draft['/standings']).toEqual([
      { on: true, days: '1' },
      { on: true, days: '2' },
      { on: true, days: '4' },
    ]);
    expect(draftState('football', draft).text).toBe('/venues=60');
  });

  it('desligar guarda o valor para religar; o texto sai com off e passa na validação do servidor', () => {
    const draft = initialDraft('football', null);
    draft['/teams']![1] = { on: false, days: '14' };
    // palpites e odds têm coluna por tier (1, 2 e 3+, o 3+ nasce desligado): desligar só o tier 2 sai coluna a coluna
    draft['/odds']![1] = { on: false, days: '1' };
    for (const cell of draft['/predictions']!) cell.on = false;
    const state = draftState('football', draft);
    expect(state.invalid.size).toBe(0);
    // na ordem do catálogo
    expect(state.text).toBe('/teams=7,off,28; /predictions=off; /odds=1,off,off');
    expect(validateSettingKey('MIRROR_PERIODS_FOOTBALL', state.text).ok).toBe(true);
  });

  it('0, vazio, decimal e acima de 365 são inválidos', () => {
    const draft = initialDraft('nba', null);
    draft['/games']![0] = { on: true, days: '0' };
    draft['/games']![1] = { on: true, days: '' };
    draft['/seasons']![0] = { on: true, days: '1.5' };
    draft['/teams']![0] = { on: true, days: '400' };
    expect([...draftState('nba', draft).invalid].sort()).toEqual([
      '/games#0',
      '/games#1',
      '/seasons#0',
      '/teams#0',
    ]);
  });
});
