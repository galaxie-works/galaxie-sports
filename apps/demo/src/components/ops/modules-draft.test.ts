import { validateSettingKey } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import type { ModulesSnapshot } from '@/lib/ops/types';

import {
  measuredApiPerDay,
  measuredModulesPerDay,
  capSliderMax,
  capStep,
  capText,
  estimatedCallsPerDay,
  initialCapDraft,
  partialInTier,
  rotationOverloaded,
  initialModuleDraft,
  measuredCallsPerDay,
  moduleDraftTexts,
  modulesNotCovering,
  modulesOfRow,
  rowSummary,
} from './modules-draft';
import { moduleDef } from '@galaxie/runtime-config';

import { mirrorPeriodsOf } from './modules-draft';

describe('rascunho dos módulos por tier', () => {
  it('parte do estado efetivo e grava só o que difere do padrão, nas duas flags', () => {
    const draft = initialModuleDraft('football', null, null);
    expect(draft['match-detail']).toEqual([true, true, true]);
    expect(draft.standings).toEqual([true, true, true]);
    expect(draft.agenda).toEqual([true]);
    const same = moduleDraftTexts('football', draft, null);
    expect(same).toMatchObject({ modules: '', mirror: '' });

    draft['match-detail'] = [true, false, false];
    draft.standings = [true, true, false];
    draft.predictions = [true, false, false];
    const texts = moduleDraftTexts('football', draft, null);
    expect(texts.modules).toBe('match-detail=on,off,off');
    expect(texts.mirror).toBe('/standings=1,2,off; /predictions=1,off,off');
    // ligar o tier 3 de palpites (nasce desligado) grava o período do catálogo, coluna a coluna
    draft.predictions = [true, true, true];
    expect(moduleDraftTexts('football', draft, null).mirror).toBe('/standings=1,2,off; /predictions=1,1,1');
    expect(validateSettingKey('MODULES_FOOTBALL', texts.modules).ok).toBe(true);
    expect(validateSettingKey('MIRROR_PERIODS_FOOTBALL', texts.mirror).ok).toBe(true);
  });

  it('lê as sobrescritas gravadas e preserva o período de um item desligado ao religar', () => {
    const draft = initialModuleDraft('football', 'trophies=on,on,off', '/standings=3,off,9; /venues=60');
    expect(draft.trophies).toEqual([true, true, false]);
    expect(draft.standings).toEqual([true, false, true]);
    draft.standings = [true, true, true];
    const texts = moduleDraftTexts('football', draft, '/standings=3,off,9; /venues=60');
    // a coluna religada volta ao padrão (2); as outras sobrescritas ficam
    expect(texts.mirror).toBe('/standings=3,2,9; /venues=60');
    expect(texts.modules).toBe('trophies=on,on,off');
  });

  it('módulo do espelho que não mudou não toca nos endpoints: o desligado um a um na página do espelho fica desligado', () => {
    const mirrorValue = '/players/topscorers=off; /standings=3,2,4';
    const draft = initialModuleDraft('football', null, mirrorValue);
    // artilharia conta como ligada (os outros três endpoints estão ligados)
    expect(draft['top-players']).toEqual([true, true, true]);
    // mexer em outro módulo não religa o /players/topscorers
    draft.predictions = [true, false, false];
    expect(moduleDraftTexts('football', draft, mirrorValue).mirror).toBe(
      '/standings=3,2,4; /players/topscorers=off; /predictions=1,off,off',
    );
    // sem mudança nenhuma, o texto é o que estava gravado
    expect(
      moduleDraftTexts('football', initialModuleDraft('football', null, mirrorValue), mirrorValue).mirror,
    ).toBe('/standings=3,2,4; /players/topscorers=off');
    // desligar o módulo num tier desliga os quatro endpoints nele; os outros tiers ficam como estavam
    draft['top-players'] = [true, false, true];
    const off = moduleDraftTexts('football', draft, mirrorValue).mirror;
    expect(off).toContain('/players/topassists=1,off,6');
    expect(off).toContain('/players/topscorers=off');
  });

  it('linhas do painel: sem tier, e por tier com a nota do que o job não cobre', () => {
    expect(modulesOfRow('football', null).map((d) => d.id)).toContain('h2h');
    // palpites, odds e estatísticas de time têm switch no tier 3 (nasce desligado)
    expect(modulesOfRow('football', 3).map((d) => d.id)).toEqual(
      expect.arrayContaining(['predictions', 'odds', 'team-stats']),
    );
    expect(modulesNotCovering('football', 3)).toEqual([]);
    // elencos: o tier 1 é do sync diário (people-rotation), então o módulo do espelho não conta como falta
    expect(modulesNotCovering('football', 1)).toEqual([]);
    const draft = initialModuleDraft('football', null, null);
    expect(draft.predictions).toEqual([true, true, false]);
    expect(rowSummary('football', draft, 3)).toMatchObject({ on: 9 });
    // outras APIs: o tier 3+ da temporada e da classificação tem switch (nasce desligado); o resto segue a temporada
    expect(modulesOfRow('basketball', 3).map((d) => d.id)).toEqual(['season', 'standings']);
    expect(initialModuleDraft('basketball', null, null).season).toEqual([true, true, false]);
  });

  it('custo medido: pelos passos do sync diário ou pelo ledger por endpoint e job', () => {
    const snapshot: ModulesSnapshot = {
      windowDays: 7,
      from: '2026-11-05',
      costs: [
        { api: 'football', endpoint: '/fixtures', job: 'sync:daily', calls: 700 },
        { api: 'football', endpoint: '/fixtures', job: 'live:run', calls: 3500 },
        { api: 'football', endpoint: '/injuries', job: 'sync:daily', calls: 7 },
        { api: 'football', endpoint: '/injuries', job: 'sync:mirror', calls: 140 },
        { api: 'basketball', endpoint: '/games', job: 'sync:daily', calls: 21 },
      ],
      steps: [
        { api: 'football', job: 'sync:daily', step: 'detalhe', calls: 420 },
        { api: 'football', job: 'sync:daily', step: 'fixtures-data', calls: 21 },
        { api: 'football', job: 'sync:daily', step: 'leagues', calls: 7 },
        { api: 'basketball', job: 'sync:daily', step: 'outros-esportes', calls: 21 },
      ],
    };
    const cost = (api: string, id: string) => measuredCallsPerDay(api, moduleDef(api, id)!, snapshot);
    expect(cost('football', 'match-detail')).toBe(60);
    expect(cost('football', 'agenda')).toBe(4);
    expect(cost('football', 'live')).toBe(500);
    expect(cost('football', 'injuries-day')).toBe(1);
    expect(cost('football', 'injuries-season')).toBe(20);
    expect(cost('football', 'wtw')).toBeNull();
    expect(cost('basketball', 'agenda')).toBe(3);
    // o cabeçalho soma só os módulos; a API inteira inclui o que está fora deles
    expect(measuredModulesPerDay('football', snapshot)).toBe(60 + 4 + 500 + 1 + 20);
    expect(measuredApiPerDay('football', snapshot)).toBe((700 + 3500 + 7 + 140) / 7);
    expect(measuredModulesPerDay('football', { ...snapshot, windowDays: 0 })).toBeNull();
    expect(
      measuredCallsPerDay('football', moduleDef('football', 'live')!, { ...snapshot, windowDays: 0 }),
    ).toBeNull();
  });

  it('estimativa por tier pelo inventário do espelho e os períodos do rascunho', () => {
    const inventory = {
      at: '2026-11-12T08:00:00Z',
      items: { '/standings': [46, 99, 900], '/predictions': [40, 60] },
    };
    const periods = new Map<string, (number | null)[]>([
      ['/standings', [1, 2, null]],
      ['/predictions', [1, 1]],
    ]);
    const standings = moduleDef('football', 'standings')!;
    expect(estimatedCallsPerDay('football', standings, periods, inventory, 1)).toBe(46);
    expect(estimatedCallsPerDay('football', standings, periods, inventory, 2)).toBe(49.5);
    expect(estimatedCallsPerDay('football', standings, periods, inventory, 3)).toBe(0);
    expect(estimatedCallsPerDay('football', standings, periods, inventory)).toBe(95.5);
    expect(
      estimatedCallsPerDay('football', moduleDef('football', 'predictions')!, periods, inventory, 2),
    ).toBe(60);
    expect(
      estimatedCallsPerDay('football', moduleDef('football', 'live')!, periods, inventory, 1),
    ).toBeNull();
    expect(estimatedCallsPerDay('football', standings, periods, null, 1)).toBeNull();
  });
});

describe('tetos diários', () => {
  it('rascunho e texto: vazio = padrão do plano, unlimited, ou o número', () => {
    expect(initialCapDraft('DAILY_MAX_DETAILS', null, true)).toEqual({ unlimited: false, value: 2000 });
    expect(initialCapDraft('DAILY_MAX_DETAILS', null, false)).toEqual({ unlimited: false, value: 35 });
    expect(initialCapDraft('DAILY_ROTATION_CALLS', 'unlimited', true)).toEqual({
      unlimited: true,
      value: 1500,
    });
    expect(initialCapDraft('DAILY_SEASON_LISTS', '120', true)).toEqual({ unlimited: false, value: 120 });
    expect(capText('DAILY_MAX_DETAILS', { unlimited: false, value: 2000 }, true)).toBe('');
    expect(capText('DAILY_MAX_DETAILS', { unlimited: false, value: 2000 }, false)).toBe('2000');
    expect(capText('DAILY_MAX_DETAILS', { unlimited: true, value: 2000 }, true)).toBe('unlimited');
    expect(capText('DAILY_PLAYER_STATS_PAGES', { unlimited: false, value: 640 }, true)).toBe('640');
  });

  it('o slider para na cota do plano', () => {
    expect(capSliderMax(7500)).toBe(7500);
    expect(capSliderMax(12_987)).toBe(12_987);
    expect(capSliderMax(null)).toBe(150_000);
    expect(capStep(300)).toBe(1);
    expect(capStep(7500)).toBe(10);
    expect(capStep(75_000)).toBe(50);
  });

  it('aviso do rodízio: afastamentos ou títulos fora do tier 1 com o teto no padrão', () => {
    const draft = initialModuleDraft('football', null, null);
    expect(rotationOverloaded(draft, 1500, true)).toBe(false);
    draft.sidelined = [true, true, false];
    expect(rotationOverloaded(draft, 1500, true)).toBe(true);
    expect(rotationOverloaded(draft, 4000, true)).toBe(false);
    expect(rotationOverloaded(draft, Number.POSITIVE_INFINITY, true)).toBe(false);
  });

  it('módulo parcial: parte dos endpoints desligada na página do espelho', () => {
    const top = moduleDef('football', 'top-players')!;
    expect(partialInTier('football', top, mirrorPeriodsOf('football', null), 1)).toBe(false);
    const periods = mirrorPeriodsOf('football', '/players/topscorers=off,3,6');
    expect(partialInTier('football', top, periods, 1)).toBe(true);
    expect(partialInTier('football', top, periods, 2)).toBe(false);
    expect(partialInTier('football', moduleDef('football', 'standings')!, periods, 1)).toBe(false);
  });
});
