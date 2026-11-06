import { describe, expect, it } from 'vitest';

import { WIDGET_KINDS } from './core/model.js';
import { WIDGET_OPTIONS, optionProps, parseWidgetOptions } from './options.js';
import { WIDGET_CATALOG } from './catalog.js';

describe('opções de conteúdo dos widgets', () => {
  it('cada opção é uma prop declarada do componente, sem chave repetida', () => {
    for (const kind of WIDGET_KINDS) {
      const keys = WIDGET_OPTIONS[kind].map((s) => s.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const key of keys) expect(WIDGET_CATALOG[kind].optionalProps as readonly string[]).toContain(key);
    }
  });

  it('guarda só chaves conhecidas, com valor válido e diferente do padrão', () => {
    expect(
      parseWidgetOptions('match_card', {
        showGoals: true,
        showVenue: true, // padrão: sai
        showReferee: 'sim', // não é booleano
        inventada: true,
      }),
    ).toEqual({ showGoals: true });
    expect(parseWidgetOptions('match_card', { showVenue: true })).toBeUndefined();
    expect(parseWidgetOptions('match_card', null)).toBeUndefined();
  });

  it('números no intervalo, listas conhecidas em ordem, ids conferidos', () => {
    expect(parseWidgetOptions('head_to_head', { limit: 99 })).toEqual({ limit: 20 });
    expect(parseWidgetOptions('team_schedule', { next: '4', recent: -2 })).toEqual({ next: 4, recent: 0 });
    expect(
      parseWidgetOptions('related_videos', { types: 'interview,goal,xyz,goal', format: 'vertical' }),
    ).toEqual({ types: 'goal,interview' });
    // praça da TV aberta não é opção do Builder (a geolocalização é da operadora)
    expect(parseWidgetOptions('where_to_watch', { region: 'SP' })).toBeUndefined();
    expect(
      parseWidgetOptions('standings', {
        season: '2025',
        table: 'annual',
        highlightTeamId: '0199A5C0-0000-7000-8000-0000000000A1',
      }),
    ).toEqual({ season: 2025, table: 'annual', highlightTeamId: '0199a5c0-0000-7000-8000-0000000000a1' });
    expect(parseWidgetOptions('standings', { highlightTeamId: 'palmeiras' })).toBeUndefined();
    expect(parseWidgetOptions('team_schedule', { competitionId: 'brasileirao-serie-a' })).toEqual({
      competitionId: 'brasileirao-serie-a',
    });
  });

  it('o formato "todos" do vídeo vira ausência do filtro nas props', () => {
    expect(optionProps('related_videos', { format: 'short' })).toEqual({ format: 'short' });
    expect(optionProps('related_videos', { format: 'both' })).toEqual({});
  });
});
