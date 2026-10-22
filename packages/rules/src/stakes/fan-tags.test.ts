import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeStake, STAKE_FAMILIES, type StakeFamily } from './codes.js';
import { renderFanTagsMarkdown } from './fan-tags-doc.js';
import {
  FAN_TAG_LOCALES,
  fanTagOf,
  fanTags,
  fanTagZoneGroup,
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
        const params = zone ? { zone } : base?.n !== undefined ? { ...base, n } : base;
        const tag = fanTagOf(makeStake('home', family, params), [locale]);
        if (family === 'extra_time_then_penalties') {
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

describe('documentação', () => {
  it('docs/rules/tags-torcedor.md está em dia com fan-tags.ts (pnpm --filter @galaxie/rules docs:labels)', () => {
    const doc = readFileSync(new URL('tags-torcedor.md', docsDir), 'utf8').replace(/\r\n/g, '\n');
    expect(doc).toBe(renderFanTagsMarkdown());
  });
});
