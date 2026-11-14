import { validateSettingKey } from '@galaxie/runtime-config';
import { describe, expect, it } from 'vitest';

import type { ModulesSnapshot } from '@/lib/ops/types';

import {
  estimatedCallsPerDay,
  initialModuleDraft,
  measuredCallsPerDay,
  moduleDraftTexts,
  modulesNotCovering,
  modulesOfRow,
  rowSummary,
} from './modules-draft';
import { moduleDef } from '@galaxie/runtime-config';

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

  it('linhas do painel: sem tier, e por tier com a nota do que o job não cobre', () => {
    expect(modulesOfRow('football', null).map((d) => d.id)).toContain('h2h');
    // palpites, odds e estatísticas de time têm switch no tier 3 (nasce desligado)
    expect(modulesOfRow('football', 3).map((d) => d.id)).toEqual(
      expect.arrayContaining(['predictions', 'odds', 'team-stats']),
    );
    expect(modulesNotCovering('football', 3)).toEqual([]);
    expect(modulesNotCovering('football', 1).map((d) => d.id)).toEqual(['people-mirror']);
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
