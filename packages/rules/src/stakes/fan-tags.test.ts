import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeStake, RESULT_FAMILIES, STAKE_FAMILIES, type StakeFamily } from './codes.js';
import { renderFanTagsMarkdown } from './fan-tags-doc.js';
import {
  FAN_TAG_LOCALES,
  FAN_TAG_RELEGATION_MAX_GAP,
  FAN_TAG_TITLE_MIN_GAP,
  FAN_TAG_ZONE_MIN_GAP,
  fanTagOf,
  fanTags,
  fanTagStanding,
  fanTagZoneGroup,
  isRelevantForFans,
  MAX_FAN_TAGS,
  type FanTagLocale,
} from './fan-tags.js';
import { exampleParams } from './labels-doc.js';

const docsDir = new URL('../../../../docs/rules/', import.meta.url);
const ZONES = [
  'libertadores_group_stage',
  'libertadores_qualifying',
  'sudamericana',
  'sudamericana_knockout_playoff',
  'champions_league',
  'champions_league_qualifying',
  'europa_league',
  'europa_league_knockout_playoff',
  'conference_league',
  'promotion',
  'round_of_16',
  'knockout_playoff',
  'playoff',
  'copa_regional',
];

describe('tabela de tags do torcedor', () => {
  it('cobre os 8 mercados e o inglês', () => {
    expect(FAN_TAG_LOCALES).toEqual([
      'pt-BR',
      'es-AR',
      'es-MX',
      'es-CO',
      'es-CL',
      'es-PE',
      'es-UY',
      'es-EC',
      'en',
    ]);
  });

  const grid: [FanTagLocale, StakeFamily][] = FAN_TAG_LOCALES.flatMap((l) =>
    STAKE_FAMILIES.map((f) => [l, f] as [FanTagLocale, StakeFamily]),
  );
  it.each(grid)('%s · %s: tag curta, interpolada e sem espaços sobrando', (locale, family) => {
    const zones = family.includes('_zone') ? ZONES : [undefined];
    for (const zone of zones) {
      for (const n of [0, 1, 2, 3]) {
        const base = exampleParams(family);
        const params = zone
          ? { ...(base?.n !== undefined ? { n } : {}), zone }
          : base?.n !== undefined
            ? { ...base, n }
            : base;
        const tag = fanTagOf(makeStake('home', family, params), [locale]);
        if (
          family === 'extra_time_then_penalties' ||
          (RESULT_FAMILIES as readonly string[]).includes(family)
        ) {
          expect(tag).toBeNull();
          continue;
        }
        const text = tag!.text[locale]!;
        expect(text.length, text).toBeGreaterThan(5);
        expect(text.length, text).toBeLessThanOrEqual(32);
        expect(text).not.toMatch(/[{}]/);
        expect(text).not.toMatch(/\s{2,}|\s$|^\s/);
        expect(tag!.priority).toBeGreaterThanOrEqual(10);
        expect(tag!.priority).toBeLessThan(60);
      }
    }
  });

  it('textos do caso de uso (pt-BR, es-AR, en)', () => {
    const text = (family: StakeFamily, params?: { n?: number; zone?: string }) =>
      fanTagOf(makeStake('home', family, params), ['pt-BR', 'es-AR', 'en'])!.text;
    expect(text('in_title_race')).toEqual({
      'pt-BR': 'Na briga pelo título',
      'es-AR': 'En la pelea por el título',
      en: 'In the title race',
    });
    expect(text('at_risk_of_relegation')['pt-BR']).toBe('Luta contra o rebaixamento');
    expect(text('can_clinch_title')['pt-BR']).toBe('Pode ser campeão hoje');
    expect(text('needs_win')['pt-BR']).toBe('Precisa vencer');
    expect(text('advances_with_draw')['pt-BR']).toBe('Avança com empate');
    expect(text('can_qualify_for_zone', { zone: 'libertadores_group_stage' })['pt-BR']).toBe(
      'De olho na Libertadores',
    );
    expect(text('qualifies_for_zone', { zone: 'sudamericana' })).toEqual({
      'pt-BR': 'Garantido na Sul-Americana',
      'es-AR': 'Clasificado a la Sudamericana',
      en: 'Sudamericana spot secured',
    });
    expect(text('needs_win_by_n', { n: 1 })).toEqual({
      'pt-BR': 'Precisa vencer por 1 gol',
      'es-AR': 'Necesita ganar por 1 gol',
      en: 'Must win by 1 goal',
    });
    expect(text('needs_win_by_n', { n: 2 })['en']).toBe('Must win by 2 goals');
  });

  it('variações regionais do espanhol', () => {
    const et = makeStake('both', 'draw_goes_to_extra_time');
    expect(fanTagOf(et, ['es-AR', 'es-MX', 'es-CO', 'es-PE', 'es-UY'])!.text).toEqual({
      'es-AR': 'El empate lleva al alargue',
      'es-MX': 'El empate lleva a tiempos extra',
      'es-CO': 'El empate lleva a tiempo extra',
      'es-PE': 'El empate lleva a suplementario',
      'es-UY': 'El empate lleva al alargue',
    });
    expect(fanTagOf(makeStake('home', 'in_title_race'), ['es-MX'])!.text['es-MX']).toBe(
      'En la lucha por el título',
    );
    const liguilla = makeStake('home', 'can_qualify_for_zone', { zone: 'playoff' });
    expect(fanTagOf(liguilla, ['es-MX', 'es-AR'])!.text).toEqual({
      'es-MX': 'En carrera por la liguilla',
      'es-AR': 'En carrera por los playoffs',
    });
  });

  it('zonas: grupo conhecido ou genérico', () => {
    expect(fanTagZoneGroup('libertadores_group_stage')).toBe('libertadores');
    expect(fanTagZoneGroup('sudamericana_knockout_playoff')).toBe('sudamericana');
    expect(fanTagZoneGroup('copa_regional')).toBe('generic');
    expect(
      fanTagOf(makeStake('home', 'can_qualify_for_zone', { zone: 'copa_regional' }), ['pt-BR'])!.text,
    ).toEqual({ 'pt-BR': 'Briga por vaga' });
  });

  it('faixas: título > rebaixamento > mata-mata > vaga continental > demais', () => {
    const p = (family: StakeFamily, params?: { n?: number; zone?: string }) =>
      fanTagOf(makeStake('home', family, params), ['pt-BR'])!.priority;
    expect(p('in_title_race')).toBeLessThan(p('mathematically_relegated'));
    expect(p('at_risk_of_relegation')).toBeLessThan(p('mathematically_eliminated'));
    expect(p('at_risk_of_elimination')).toBeLessThan(p('can_clinch_zone', { zone: 'libertadores' }));
    expect(p('qualifies_for_zone', { zone: 'conference_league' })).toBeLessThan(p('first_leg'));
    expect(p('safe_from_relegation')).toBeGreaterThan(p('qualifies_for_zone', { zone: 'sudamericana' }));
    // dentro da faixa: o que se decide na rodada vem antes do que ainda está em disputa
    expect(p('can_clinch_title')).toBeLessThan(p('in_title_race'));
    expect(p('can_qualify_for_zone', { zone: 'libertadores_group_stage' })).toBeLessThan(
      p('qualifies_for_zone', { zone: 'sudamericana' }),
    );
  });
});

describe('fanTags (por participante)', () => {
  it('Palmeiras × Bragantino: cada torcida vê as suas tags', () => {
    const stakes = [
      makeStake('home', 'in_title_race'),
      makeStake('home', 'can_qualify_for_zone', { zone: 'libertadores_group_stage' }),
      makeStake('away', 'at_risk_of_relegation'),
      makeStake('away', 'can_qualify_for_zone', { zone: 'libertadores_group_stage' }),
    ];
    expect(fanTags(stakes, 'home', ['pt-BR'])).toEqual([
      { code: 'in_title_race', priority: 15, text: { 'pt-BR': 'Na briga pelo título' } },
      {
        code: 'can_qualify_for_libertadores_group_stage',
        priority: 43,
        text: { 'pt-BR': 'De olho na Libertadores' },
      },
    ]);
    expect(fanTags(stakes, 'away', ['pt-BR']).map((t) => t.text['pt-BR'])).toEqual([
      'Luta contra o rebaixamento',
      'De olho na Libertadores',
    ]);
  });

  it('stakes `both` valem para os dois lados', () => {
    const stakes = [
      makeStake('home', 'advances_with_draw'),
      makeStake('away', 'needs_win'),
      makeStake('both', 'draw_goes_to_penalties'),
      makeStake('both', 'decides_title'),
    ];
    expect(fanTags(stakes, 'home', ['pt-BR']).map((t) => t.code)).toEqual([
      'decides_title',
      'advances_with_draw',
      'draw_goes_to_penalties',
    ]);
    expect(fanTags(stakes, 'away', ['pt-BR']).map((t) => t.code)).toEqual([
      'decides_title',
      'needs_win',
      'draw_goes_to_penalties',
    ]);
  });

  it('funde tags idênticas mantendo a mais relevante', () => {
    const stakes = [
      makeStake('home', 'away_goals_rule'),
      makeStake('home', 'outcome_depends_on_away_goals', { n: 1 }),
      makeStake('home', 'can_qualify_for_zone', { zone: 'libertadores_qualifying' }),
      makeStake('home', 'can_qualify_for_zone', { zone: 'libertadores_group_stage' }),
    ];
    const tags = fanTags(stakes, 'home', ['pt-BR', 'es-AR']);
    expect(tags.map((t) => t.text['pt-BR'])).toEqual(['Gol fora pesa', 'De olho na Libertadores']);
    expect(tags[0]!.code).toBe('win_by_1_depends_on_away_goals');
    expect(tags[1]!.code).toBe('can_qualify_for_libertadores_qualifying');
  });

  it(`corta em ${MAX_FAN_TAGS} e respeita max`, () => {
    const stakes = [
      makeStake('home', 'qualifies_for_zone', { zone: 'sudamericana' }),
      makeStake('home', 'safe_from_relegation'),
      makeStake('home', 'can_clinch_zone', { zone: 'libertadores_group_stage' }),
      makeStake('home', 'in_title_race'),
      makeStake('both', 'first_leg'),
    ];
    expect(fanTags(stakes, 'home', ['pt-BR']).map((t) => t.text['pt-BR'])).toEqual([
      'Na briga pelo título',
      'Pode garantir a Libertadores',
      'Garantido na Sul-Americana',
    ]);
    expect(fanTags(stakes, 'home', ['pt-BR'], 1)).toHaveLength(1);
    expect(fanTags(stakes, 'away', ['pt-BR']).map((t) => t.code)).toEqual(['first_leg']);
  });

  it('sem stakes ou só códigos informativos → []', () => {
    expect(fanTags([], 'home')).toEqual([]);
    expect(fanTags([makeStake('both', 'extra_time_then_penalties')], 'away')).toEqual([]);
  });
});

describe('relevância para o torcedor (Brasileirão 2026, 31 rodadas, faltam 7)', () => {
  // Tabela antes da rodada 32 (Vasco e Chapecoense com um jogo a menos).
  const ROWS: [string, number, number][] = [
    ['flamengo', 67, 31],
    ['palmeiras', 66, 31],
    ['athletico', 53, 31],
    ['cruzeiro', 51, 31],
    ['fluminense', 51, 31],
    ['atletico-mg', 50, 31],
    ['bahia', 49, 31],
    ['santos', 45, 31],
    ['sao-paulo', 42, 31],
    ['bragantino', 41, 31],
    ['botafogo', 39, 31],
    ['coritiba', 39, 31],
    ['vitoria', 37, 31],
    ['mirassol', 36, 31],
    ['vasco', 35, 30],
    ['corinthians', 33, 31],
    ['internacional', 32, 31],
    ['gremio', 31, 31],
    ['remo', 26, 31],
    ['chapecoense', 18, 30],
  ];
  const table = ROWS.map(([teamId, points, played]) => ({ teamId, points, played }));
  const league = {
    matchesPerTeam: 38,
    title: true,
    zones: [
      { id: 'libertadores_group_stage', kind: 'qualification' as const, from: 1, to: 4 },
      { id: 'libertadores_qualifying', kind: 'qualification' as const, from: 5, to: 6 },
      { id: 'sudamericana', kind: 'qualification' as const, from: 7, to: 12 },
      { id: 'relegation', kind: 'relegation' as const, from: 17, to: 20 },
    ],
  };
  const standing = (team: string) => fanTagStanding(table, league, team);
  const tagsOf = (team: string, ...families: [StakeFamily, { zone?: string }?][]) =>
    fanTags(
      families.map(([f, params]) => makeStake('home', f, params)),
      'home',
      ['pt-BR'],
      MAX_FAN_TAGS,
      standing(team),
    ).map((t) => t.text['pt-BR']);

  it('limites em constantes nomeadas', () => {
    expect([FAN_TAG_TITLE_MIN_GAP, FAN_TAG_RELEGATION_MAX_GAP, FAN_TAG_ZONE_MIN_GAP]).toEqual([6, 6, 6]);
  });

  it('situação na tabela: posição, rodadas restantes, líder, zona de rebaixamento e linhas das vagas', () => {
    expect(standing('sao-paulo')).toEqual({
      points: 42,
      rank: 9,
      remaining: 7,
      leaderPoints: 67,
      relegation: { from: 17, points: 32 },
      zoneLinePoints: { libertadores_group_stage: 51, libertadores_qualifying: 50, sudamericana: 39 },
    });
    expect(standing('vasco')?.remaining).toBe(8);
    expect(standing('fora-da-tabela')).toBeNull();
    expect(fanTagStanding(table, { ...league, title: false, zones: [] }, 'flamengo')).toMatchObject({
      leaderPoints: null,
      relegation: null,
      zoneLinePoints: {},
    });
  });

  it('título: só até max(6, rodadas restantes) do líder — o líder entra', () => {
    expect(tagsOf('flamengo', ['in_title_race'])).toEqual(['Na briga pelo título']);
    expect(tagsOf('palmeiras', ['in_title_race'])).toEqual(['Na briga pelo título']);
    // Cruzeiro: 16 pontos atrás com 7 rodadas
    expect(tagsOf('cruzeiro', ['in_title_race'])).toEqual([]);
    // decisivas continuam valendo
    expect(tagsOf('cruzeiro', ['can_clinch_title'])).toEqual(['Pode ser campeão hoje']);
  });

  it('rebaixamento: na zona ou até 6 pontos acima do primeiro time dentro dela', () => {
    expect(tagsOf('sao-paulo', ['at_risk_of_relegation'])).toEqual([]); // 10 acima do Z4
    expect(tagsOf('bragantino', ['at_risk_of_relegation'])).toEqual([]); // 9 acima
    expect(tagsOf('vitoria', ['at_risk_of_relegation'])).toEqual(['Luta contra o rebaixamento']); // 5
    expect(tagsOf('mirassol', ['at_risk_of_relegation'])).toEqual(['Luta contra o rebaixamento']); // 4
    expect(tagsOf('remo', ['at_risk_of_relegation'])).toEqual(['Luta contra o rebaixamento']); // na zona
    expect(tagsOf('sao-paulo', ['can_be_relegated'])).toEqual(['Pode ser rebaixado hoje']);
    expect(tagsOf('bragantino', ['relegated_unless_wins'])).toEqual(['Vencer ou cair']);
  });

  it('permanência: mesmo critério do rebaixamento (some no alto da tabela, fica perto da zona)', () => {
    const safety: StakeFamily[] = [
      'secures_safety_with_win',
      'secures_safety_with_draw',
      'can_secure_safety',
      'safe_from_relegation',
    ];
    for (const team of ['cruzeiro', 'athletico', 'bahia', 'atletico-mg', 'flamengo'])
      for (const f of safety) expect(tagsOf(team, [f]), `${team} ${f}`).toEqual([]);
    // Corinthians, 1 ponto acima do Z4, e Grêmio, dentro dele, mantêm
    expect(tagsOf('corinthians', ['secures_safety_with_win'])).toEqual(['Vitória garante a permanência']);
    expect(tagsOf('corinthians', ['can_secure_safety'])).toEqual(['Pode se salvar hoje']);
    expect(tagsOf('vitoria', ['secures_safety_with_draw'])).toEqual(['Empate garante a permanência']);
    expect(tagsOf('gremio', ['can_secure_safety'])).toEqual(['Pode se salvar hoje']);
    expect(tagsOf('mirassol', ['safe_from_relegation'])).toEqual(['Livre do rebaixamento']);
    // no alto, só sobra o que é relevante: Cruzeiro fica com a vaga
    expect(
      tagsOf(
        'cruzeiro',
        ['secures_safety_with_win'],
        ['in_title_race'],
        ['can_qualify_for_zone', { zone: 'libertadores_group_stage' }],
      ),
    ).toEqual(['De olho na Libertadores']);
  });

  it('vagas: até max(6, rodadas restantes) do último time dentro da zona', () => {
    const lib = { zone: 'libertadores_group_stage' };
    expect(tagsOf('bragantino', ['can_qualify_for_zone', lib])).toEqual([]); // 10 atrás do 4º
    expect(tagsOf('santos', ['can_qualify_for_zone', lib])).toEqual(['De olho na Libertadores']); // 6
    expect(tagsOf('bragantino', ['can_qualify_for_zone', { zone: 'sudamericana' }])).toEqual([
      'De olho na Sul-Americana',
    ]);
    // zona fora do regulamento: sem linha, sem filtro
    expect(tagsOf('bragantino', ['can_qualify_for_zone', { zone: 'copa_regional' }])).toEqual([
      'Briga por vaga',
    ]);
    expect(tagsOf('bragantino', ['can_clinch_zone', lib])).toEqual(['Pode garantir a Libertadores']);
  });

  it('sem situação na tabela (mata-mata, sem regulamento): nada é filtrado', () => {
    const stake = makeStake('home', 'in_title_race');
    expect(isRelevantForFans(stake, null)).toBe(true);
    expect(fanTags([stake], 'home', ['pt-BR'])).toHaveLength(1);
  });
});

describe('documentação', () => {
  it('docs/rules/tags-torcedor.md está em dia com fan-tags.ts (pnpm --filter @galaxie/rules docs:labels)', () => {
    const doc = readFileSync(new URL('tags-torcedor.md', docsDir), 'utf8').replace(/\r\n/g, '\n');
    expect(doc).toBe(renderFanTagsMarkdown());
  });
});
