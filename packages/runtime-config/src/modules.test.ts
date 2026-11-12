import { describe, expect, it } from 'vitest';
import {
  MIRROR_CATALOG,
  formatMirrorPeriods,
  mirrorConfigFromEnv,
  mirrorItem,
  tierColumn,
} from './mirror.js';
import {
  AGENT_MAX_TIER,
  DEFAULT_MODULE_CONFIG,
  MATCH_DETAIL_MAX_TIER,
  MODULE_APIS,
  MODULE_CATALOG,
  applyModuleToMirrorPeriods,
  formatModules,
  moduleColumn,
  moduleColumns,
  moduleConfig,
  moduleConfigFromEnv,
  moduleDef,
  moduleTierOf,
  modulesKey,
  parseModules,
} from './modules.js';
import { APISPORTS_APIS, settingDef } from './registry.js';
import { validateSettingKey } from './resolve.js';

describe('catálogo de módulos', () => {
  it('cobre as 12 APIs', () => {
    expect([...MODULE_APIS].sort()).toEqual([...APISPORTS_APIS].sort());
  });

  it('cada item do espelho está em exatamente um módulo', () => {
    for (const api of MODULE_APIS) {
      const seen = new Map<string, string>();
      for (const def of MODULE_CATALOG[api]!)
        for (const item of def.items) {
          expect(mirrorItem(api, item), `${api} ${def.id} ${item}`).toBeDefined();
          expect(seen.get(item), `${api} ${item} em ${seen.get(item)} e ${def.id}`).toBeUndefined();
          seen.set(item, def.id);
        }
      for (const item of MIRROR_CATALOG[api]!) expect(seen.has(item.id), `${api} ${item.id}`).toBe(true);
    }
  });

  it('ids únicos, um padrão por switch, jobs e tiers válidos', () => {
    for (const api of MODULE_APIS) {
      const ids = MODULE_CATALOG[api]!.map((d) => d.id);
      expect(new Set(ids).size, api).toBe(ids.length);
      for (const def of MODULE_CATALOG[api]!) {
        expect(def.defaults, `${api} ${def.id}`).toHaveLength(moduleColumns(def));
        expect(def.jobs.length, `${api} ${def.id}`).toBeGreaterThan(0);
        for (const t of def.tiers) expect([1, 2, 3]).toContain(t);
        if (def.kind === 'mirror') expect(def.items.length).toBeGreaterThan(0);
        else expect(def.items).toEqual([]);
      }
    }
  });

  it('o padrão reproduz o comportamento de hoje', () => {
    const f = DEFAULT_MODULE_CONFIG.api('football');
    expect(f.states('agenda')).toEqual([true]);
    expect(f.tiersOn('season-list')).toEqual([1, 2, 3]);
    expect(f.tiersOn('match-detail')).toEqual([1, 2]);
    expect(f.maxTier('match-detail')).toBe(MATCH_DETAIL_MAX_TIER);
    expect(f.tiersOn('live')).toEqual([1, 2, 3]);
    expect(f.tiersOn('people-rotation')).toEqual([1]);
    expect(f.tiersOn('people-mirror')).toEqual([2, 3]);
    expect(f.tiersOn('sidelined')).toEqual([1]);
    expect(f.tiersOn('trophies')).toEqual([1]);
    expect(f.tiersOn('predictions')).toEqual([1, 2]);
    expect(f.tiersOn('odds')).toEqual([1, 2]);
    expect(f.tiersOn('team-stats')).toEqual([1, 2]);
    expect(f.tiersOn('standings')).toEqual([1, 2, 3]);
    expect(f.tiersOn('player-stats')).toEqual([1]);
    expect(f.tiersOn('wtw')).toEqual([1, 2]);
    expect(f.maxTier('ai-content')).toBe(AGENT_MAX_TIER);
    expect(f.enabled('h2h')).toBe(true);
    expect(f.enabled('match-detail', 3)).toBe(false);
    expect(f.enabled('match-detail', 0)).toBe(true);
    expect(f.enabled('match-detail', null)).toBe(true);
    const b = DEFAULT_MODULE_CONFIG.api('basketball');
    expect(b.tiersOn('season')).toEqual([1, 2]);
    expect(b.enabled('odds')).toBe(true);
    expect(moduleDef('basketball', 'injuries')).toBeUndefined();
    expect(DEFAULT_MODULE_CONFIG.api('american-football').tiersOn('injuries')).toEqual([1, 2]);
    expect(DEFAULT_MODULE_CONFIG.api('mma').enabled('participants')).toBe(true);
  });

  it('tier da competição na coluna dos módulos', () => {
    expect(moduleTierOf(0)).toBe(1);
    expect(moduleTierOf(2)).toBe(2);
    expect(moduleTierOf(7)).toBe(3);
    expect(moduleTierOf(null)).toBe(3);
    const people = moduleDef('football', 'people-mirror')!;
    expect(moduleColumn(people, 1)).toBe(-1);
    expect(moduleColumn(people, 2)).toBe(0);
    expect(moduleColumn(people, 3)).toBe(1);
    expect(DEFAULT_MODULE_CONFIG.api('football').enabled('people-mirror', 1)).toBe(false);
    expect(moduleColumn(moduleDef('football', 'h2h')!, 3)).toBe(0);
  });
});

describe('MODULES_<API>', () => {
  it('lê só o que foi citado, com um valor valendo para todos os tiers', () => {
    const r = parseModules('football', 'match-detail=on; trophies=on,off,on');
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.value.get('match-detail')).toEqual([true, true, true]);
    expect(r.value.get('trophies')).toEqual([true, false, true]);
    expect(r.value.has('live')).toBe(false);
    expect(parseModules('football', '')).toEqual({ ok: true, value: new Map() });
  });

  it('recusa módulo desconhecido, do espelho, valor estranho e contagem errada', () => {
    expect(parseModules('football', 'xpto=on')).toMatchObject({ ok: false, error: { code: 'format' } });
    expect(parseModules('football', 'standings=off')).toMatchObject({ ok: false, error: { code: 'format' } });
    expect(parseModules('football', 'live=maybe')).toMatchObject({ ok: false, error: { code: 'format' } });
    expect(parseModules('football', 'live=on,off')).toMatchObject({ ok: false, error: { code: 'format' } });
    expect(parseModules('football', 'live=on; live=off')).toMatchObject({
      ok: false,
      error: { code: 'format' },
    });
    expect(parseModules('football', 'injuries-day=on,off')).toMatchObject({ ok: false });
  });

  it('o registro valida pela mesma regra, com padrão vazio e crítico', () => {
    expect(validateSettingKey(modulesKey('football'), 'sidelined=on,on,off')).toEqual({
      ok: true,
      value: 'sidelined=on,on,off',
    });
    expect(validateSettingKey('MODULES_AMERICAN_FOOTBALL', '')).toEqual({ ok: true, value: '' });
    expect(validateSettingKey(modulesKey('football'), 'odds=off')).toMatchObject({ ok: false });
    const def = settingDef(modulesKey('football'))!;
    expect(def.default).toBeNull();
    expect(def.critical).toBe(true);
    expect(def.services).toEqual(['ingestor', 'live', 'agents']);
  });

  it('texto canônico: só o que difere do padrão, na ordem do catálogo', () => {
    const states = new Map<string, boolean[]>([
      ['trophies', [true, true, false]],
      ['match-detail', [true, true, false]],
      ['injuries-day', [false]],
      ['live', [false, false, false]],
    ]);
    expect(formatModules('football', states)).toBe('injuries-day=off; live=off; trophies=on,on,off');
    expect(formatModules('football', new Map())).toBe('');
  });
});

describe('moduleConfig', () => {
  it('aplica as sobrescritas e lê os módulos do espelho dos períodos', () => {
    const env: Record<string, string> = {
      MODULES_FOOTBALL: 'match-detail=on; live=on,on,off',
      MIRROR_PERIODS_FOOTBALL: '/predictions=1,off; /players/squads=off,14',
    };
    const cfg = moduleConfigFromEnv(env, mirrorConfigFromEnv(env)).api('football');
    expect(cfg.tiersOn('match-detail')).toEqual([1, 2, 3]);
    expect(cfg.maxTier('match-detail')).toBe(3);
    expect(cfg.enabled('live', 3)).toBe(false);
    expect(cfg.enabled('live', 5)).toBe(false);
    expect(cfg.enabled('live', 2)).toBe(true);
    expect(cfg.tiersOn('predictions')).toEqual([1]);
    // elenco: /players/squads desligado no tier 2, mas /coachs e /transfers seguem ligados
    expect(cfg.states('people-mirror')).toEqual([true, true]);
  });

  it('o job recusa valor inválido; o painel volta ao padrão', () => {
    const env = { MODULES_FOOTBALL: 'live=talvez' };
    expect(() => moduleConfigFromEnv(env).api('football')).toThrow(/MODULES_FOOTBALL/);
    expect(
      moduleConfig((k) => (env as Record<string, string>)[k])
        .api('football')
        .tiersOn('live'),
    ).toEqual([1, 2, 3]);
  });

  it('as sobrescritas do espelho desligam o tier de um módulo do espelho', () => {
    const env = { MIRROR_PERIODS_FOOTBALL: '/standings=off,2,4' };
    const cfg = moduleConfig((k) => (env as Record<string, string>)[k], { mirror: mirrorConfigFromEnv(env) });
    expect(cfg.api('football').tiersOn('standings')).toEqual([2, 3]);
    expect(cfg.api('football').enabled('standings', 1)).toBe(false);
  });
});

describe('applyModuleToMirrorPeriods', () => {
  it('desligar vira off na coluna do tier; religar volta ao período de antes ou ao padrão', () => {
    const def = moduleDef('football', 'predictions')!;
    const base = new Map([['/predictions', [1, 1]]]);
    const off = applyModuleToMirrorPeriods('football', def, [true, false], base);
    expect(off.get('/predictions')).toEqual([1, null]);
    expect(formatMirrorPeriods('football', off)).toBe('/predictions=1,off');
    const on = applyModuleToMirrorPeriods('football', def, [true, true], off);
    expect(on.get('/predictions')).toEqual([1, 1]);
  });

  it('módulo com vários itens e sem tier mexe em todos os itens', () => {
    const def = moduleDef('football', 'reference')!;
    const off = applyModuleToMirrorPeriods('football', def, [false], new Map());
    for (const item of def.items) expect(off.get(item)).toEqual([null]);
    const back = applyModuleToMirrorPeriods('football', def, [true], off);
    for (const item of def.items) expect(back.get(item)).toEqual([7]);
  });

  it('elenco tier 2+ do espelho: as colunas 2 e 3+ dos itens', () => {
    const def = moduleDef('football', 'people-mirror')!;
    const squads = mirrorItem('football', '/players/squads')!;
    expect(tierColumn(squads, 1)).toBe(0);
    expect(tierColumn(squads, 2)).toBe(0);
    expect(tierColumn(squads, 3)).toBe(1);
    const off = applyModuleToMirrorPeriods('football', def, [true, false], new Map());
    expect(off.get('/players/squads')).toEqual([14, null]);
    expect(off.get('/coachs')).toEqual([30, null]);
    expect(formatMirrorPeriods('football', off)).toBe(
      '/players/squads=14,off; /coachs=30,off; /transfers=30,off',
    );
  });
});
