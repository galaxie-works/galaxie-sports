import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIRROR_CONFIG,
  MIRROR_APIS,
  MIRROR_CATALOG,
  estimateMirrorCalls,
  formatMirrorPeriods,
  mirrorConfig,
  mirrorConfigFromEnv,
  mirrorGroups,
  mirrorPeriodsKey,
  parseMirrorGroupOrder,
  parseMirrorInventory,
  parseMirrorPeriods,
  periodColumns,
} from './mirror.js';
import { APISPORTS_APIS, settingDef } from './registry.js';
import { validateSettingKey } from './resolve.js';

describe('catálogo do espelho', () => {
  it('cobre as 12 APIs da api-sports', () => {
    expect([...MIRROR_APIS].sort()).toEqual([...APISPORTS_APIS].sort());
  });

  it('cada item tem um período padrão por coluna, entre 1 e 365 dias, e um grupo da API', () => {
    for (const api of MIRROR_APIS)
      for (const def of MIRROR_CATALOG[api]!) {
        expect(def.defaults, `${api} ${def.id}`).toHaveLength(periodColumns(def));
        for (const d of def.defaults) expect(d).toBeGreaterThanOrEqual(1);
        expect(mirrorGroups(api)).toContain(def.group);
        for (const g of def.tierGroups ?? []) expect(mirrorGroups(api)).toContain(g);
      }
  });

  it('nenhum id repetido numa API', () => {
    for (const api of MIRROR_APIS) {
      const ids = MIRROR_CATALOG[api]!.map((d) => d.id);
      expect(new Set(ids).size, api).toBe(ids.length);
    }
  });

  it('os padrões são os de antes da configuração (#855/#894)', () => {
    const f = DEFAULT_MIRROR_CONFIG.api('football');
    expect(f.periods('/standings')).toEqual([1, 2, 4]);
    expect(f.periods('/teams')).toEqual([7, 14, 28]);
    expect(f.period('/teams/statistics', 1)).toBe(7);
    expect(f.period('/teams/statistics', 2)).toBe(14);
    expect(f.period('/players/topyellowcards', 3)).toBe(14);
    expect(f.period('/venues')).toBe(30);
    expect(f.groupOrder).toEqual(['temporada', 'palpites-odds', 'estatisticas', 'tier3', 'elencos']);
    const b = DEFAULT_MIRROR_CONFIG.api('basketball');
    expect(b.period('/leagues')).toBe(1);
    expect(b.period('/games', 1)).toBe(2);
    expect(b.period('/games', 2)).toBe(7);
    expect(DEFAULT_MIRROR_CONFIG.budgetPercent).toBe(20);
  });
});

describe('MIRROR_PERIODS_<API>', () => {
  it('lê só o que foi citado, com um valor valendo para todos os tiers', () => {
    const r = parseMirrorPeriods('football', '/standings=2; /injuries=off ; /teams=7,off,30');
    expect(r).toEqual({
      ok: true,
      value: new Map([
        ['/standings', [2, 2, 2]],
        ['/injuries', [null, null, null]],
        ['/teams', [7, null, 30]],
      ]),
    });
  });

  it('recusa 0, fora da faixa, endpoint desconhecido e número errado de tiers', () => {
    expect(parseMirrorPeriods('football', '/standings=0')).toMatchObject({
      ok: false,
      error: { code: 'periodZero' },
    });
    expect(parseMirrorPeriods('football', '/standings=1,0,2')).toMatchObject({
      ok: false,
      error: { code: 'periodZero' },
    });
    expect(parseMirrorPeriods('football', '/venues=400')).toMatchObject({
      ok: false,
      error: { code: 'range', min: 1, max: 365 },
    });
    expect(parseMirrorPeriods('football', '/nao-existe=3')).toMatchObject({
      ok: false,
      error: { code: 'mirrorItem', values: ['/nao-existe'] },
    });
    expect(parseMirrorPeriods('football', '/standings=1,2')).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
    expect(parseMirrorPeriods('football', '/venues=1.5')).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
    expect(parseMirrorPeriods('football', 'venues=3')).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
  });

  it('o registro valida pela mesma regra', () => {
    expect(validateSettingKey(mirrorPeriodsKey('football'), '/odds=0')).toMatchObject({
      ok: false,
      error: { code: 'periodZero' },
    });
    expect(validateSettingKey(mirrorPeriodsKey('nba'), '/players/statistics?game=2')).toEqual({
      ok: true,
      value: '/players/statistics?game=2',
    });
    expect(validateSettingKey(mirrorPeriodsKey('nba'), '')).toEqual({ ok: true, value: '' });
  });

  it('texto canônico: só o que difere do padrão, na ordem do catálogo', () => {
    const periods = new Map([
      ['/venues', [60]],
      ['/standings', [1, 2, 4]],
      ['/teams', [7, null, 28]],
      ['/injuries', [null, null, null]],
    ]);
    expect(formatMirrorPeriods('football', periods)).toBe('/injuries=off; /teams=7,off,28; /venues=60');
    expect(formatMirrorPeriods('football', new Map())).toBe('');
  });
});

describe('orçamento e ordem dos grupos', () => {
  it('orçamento: 1 a 50%, 0 recusado', () => {
    expect(validateSettingKey('MIRROR_BUDGET_PERCENT', '30')).toEqual({ ok: true, value: '30' });
    expect(validateSettingKey('MIRROR_BUDGET_PERCENT', '0')).toMatchObject({
      ok: false,
      error: { code: 'zero' },
    });
    expect(validateSettingKey('MIRROR_BUDGET_PERCENT', '60')).toMatchObject({
      ok: false,
      error: { code: 'range' },
    });
    expect(settingDef('MIRROR_BUDGET_PERCENT')?.default).toBe('20');
  });

  it('ordem: cada grupo uma vez', () => {
    expect(parseMirrorGroupOrder('basketball', 'por-time,temporada,por-jogo')).toEqual({
      ok: true,
      value: ['por-time', 'temporada', 'por-jogo'],
    });
    expect(parseMirrorGroupOrder('basketball', 'por-time,temporada')).toMatchObject({ ok: false });
    expect(parseMirrorGroupOrder('basketball', 'por-time,por-time,temporada')).toMatchObject({ ok: false });
    expect(validateSettingKey('MIRROR_GROUP_ORDER_FOOTBALL', 'tier3,temporada')).toMatchObject({
      ok: false,
      error: { code: 'groupOrder' },
    });
  });
});

describe('mirrorConfig', () => {
  it('aplica as sobrescritas', () => {
    const env: Record<string, string> = {
      MIRROR_PERIODS_FOOTBALL: '/standings=3,off,9',
      MIRROR_BUDGET_PERCENT: '35',
      MIRROR_GROUP_ORDER_SPORTS: 'por-jogo,por-time,temporada',
    };
    const cfg = mirrorConfigFromEnv(env);
    expect(cfg.budgetPercent).toBe(35);
    const f = cfg.api('football');
    expect(f.period('/standings', 1)).toBe(3);
    expect(f.period('/standings', 2)).toBeNull();
    expect(f.period('/standings', 5)).toBe(9);
    expect(f.period('/odds')).toBe(1);
    expect(cfg.api('rugby').groupOrder).toEqual(['por-jogo', 'por-time', 'temporada']);
  });

  it('o job recusa valor inválido; o painel e as métricas voltam ao padrão', () => {
    const env = { MIRROR_PERIODS_FOOTBALL: '/standings=0', MIRROR_BUDGET_PERCENT: '90' };
    expect(() => mirrorConfigFromEnv(env).api('football')).toThrow(/MIRROR_BUDGET_PERCENT/);
    expect(() => mirrorConfigFromEnv({ MIRROR_PERIODS_FOOTBALL: '/standings=0' }).api('football')).toThrow(
      /MIRROR_PERIODS_FOOTBALL/,
    );
    const lenient = mirrorConfig((k) => (env as Record<string, string>)[k]);
    expect(lenient.budgetPercent).toBe(20);
    expect(lenient.api('football').periods('/standings')).toEqual([1, 2, 4]);
  });
});

describe('estimativa de chamadas', () => {
  it('pedidos ÷ período de cada coluna ligada', () => {
    const inv = parseMirrorInventory({
      at: '2026-11-07T08:00:00.000Z',
      items: { '/standings': [20, 40, 400], '/venues': [90], lixo: 'x' },
    });
    expect(inv?.items).not.toHaveProperty('lixo');
    expect(inv?.plan).toBeUndefined();
    expect(parseMirrorInventory({ at: '2026-11-07T08:00:00.000Z', plan: 'pro', items: {} })?.plan).toBe(
      'pro',
    );
    const cfg = mirrorConfig((k) => (k === 'MIRROR_PERIODS_FOOTBALL' ? '/standings=1,2,off' : null));
    const est = estimateMirrorCalls('football', (id) => cfg.api('football').periods(id), inv);
    const standings = est.items.find((i) => i.id === '/standings')!;
    expect(standings).toEqual({ id: '/standings', requests: 460, callsPerDay: 40 });
    expect(est.items.find((i) => i.id === '/venues')!.callsPerDay).toBe(3);
    expect(est.total).toBe(43);
  });

  it('sem inventário, zero', () => {
    expect(estimateMirrorCalls('mma', () => [1], null).total).toBe(0);
    expect(parseMirrorInventory(null)).toBeNull();
  });
});
