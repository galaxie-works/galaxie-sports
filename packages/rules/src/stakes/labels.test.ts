import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makeStake, STAKE_FAMILIES, stakeCode, TITLE_VARIANT_OF, type StakeFamily } from './codes.js';
import { exampleParams, renderLabelsMarkdown } from './labels-doc.js';
import {
  isStakeLocale,
  localizeStake,
  STAKE_LABELS,
  STAKE_LOCALES,
  stakeText,
  ZONE_LABELS,
  zoneLabel,
  type StakeLocale,
} from './labels.js';

const docsDir = new URL('../../../../docs/rules/', import.meta.url);

describe('mapa de rótulos', () => {
  it('cobre os 8 mercados da API', () => {
    expect(STAKE_LOCALES).toEqual(['pt-BR', 'es-AR', 'es-MX', 'es-CO', 'es-CL', 'es-PE', 'es-UY', 'es-EC']);
    expect(Object.keys(STAKE_LABELS).sort()).toEqual([...STAKE_LOCALES].sort());
    expect(Object.keys(ZONE_LABELS).sort()).toEqual([...STAKE_LOCALES].sort());
  });

  const grid: [StakeLocale, StakeFamily][] = STAKE_LOCALES.flatMap((l) =>
    STAKE_FAMILIES.map((f) => [l, f] as [StakeLocale, StakeFamily]),
  );
  it.each(grid)('%s · %s: rótulo presente e totalmente interpolado', (locale, family) => {
    for (const n of [0, 1, 2, 3]) {
      const params = exampleParams(family)
        ? { ...exampleParams(family), ...(exampleParams(family)!.n !== undefined ? { n } : {}) }
        : undefined;
      const text = stakeText(makeStake('home', family, params), locale);
      expect(text.length).toBeGreaterThan(5);
      expect(text).not.toMatch(/[{}]/);
      expect(text).not.toMatch(/\s{2,}|\s$/);
      if (params?.zone) expect(text).toContain(zoneLabel(params.zone, locale));
    }
  });

  it('famílias com zona sempre declaram {zone}; com gols, {n} ou {goals}', () => {
    for (const locale of STAKE_LOCALES) {
      for (const family of STAKE_FAMILIES) {
        const t = STAKE_LABELS[locale][family];
        const all = typeof t === 'string' ? [t] : [t.other, t.zero, t.one].filter(Boolean);
        if (family.includes('_zone'))
          for (const s of all) expect(s, `${locale} ${family}`).toContain('{zone}');
        if (/(^|_)n(_|$)/.test(family) && family !== 'advances_with_draw_up_to_n') {
          expect(all[0], `${locale} ${family}`).toMatch(/\{(n|goals)\}/);
        }
      }
    }
  });

  it.each([
    ['pt-BR', 1, 'Precisa vencer por 1 gol para avançar direto'],
    ['pt-BR', 3, 'Precisa vencer por 3 gols para avançar direto'],
    ['es-AR', 1, 'Necesita ganar por 1 gol para avanzar directo'],
    ['es-MX', 2, 'Necesita ganar por 2 goles para avanzar directo'],
  ] as const)('plural de gols — %s n=%i', (locale, n, expected) => {
    expect(stakeText(makeStake('away', 'needs_win_by_n', { n }), locale)).toBe(expected);
  });

  it('variantes regionais (prorrogação e rodada)', () => {
    const et = makeStake('both', 'draw_goes_to_extra_time');
    expect(localizeStake(et).text).toEqual({
      'pt-BR': 'Empate leva o jogo à prorrogação',
      'es-AR': 'El empate lleva el partido al alargue',
      'es-MX': 'El empate lleva el partido a tiempos extra',
      'es-CO': 'El empate lleva el partido al tiempo extra',
      'es-CL': 'El empate lleva el partido al alargue',
      'es-PE': 'El empate lleva el partido al tiempo suplementario',
      'es-UY': 'El empate lleva el partido al alargue',
      'es-EC': 'El empate lleva el partido al tiempo extra',
    });
    expect(stakeText(makeStake('home', 'can_clinch_title'), 'es-MX')).toContain('jornada');
    expect(stakeText(makeStake('home', 'can_clinch_title'), 'es-CO')).toContain('fecha');
  });

  it('empate sem gols usa a variante zero', () => {
    expect(stakeText(makeStake('home', 'advances_with_draw_up_to_n', { n: 0 }), 'pt-BR')).toBe(
      'Avança com empate sem gols',
    );
    expect(stakeText(makeStake('both', 'specific_draw_goes_to_penalties', { n: 0 }), 'es-AR')).toBe(
      'El 0 a 0 lleva la definición a los penales',
    );
  });

  it('zona desconhecida cai no id legível', () => {
    expect(zoneLabel('copa_regional', 'pt-BR')).toBe('copa regional');
    expect(stakeText(makeStake('home', 'qualifies_for_zone', { zone: 'sudamericana' }), 'pt-BR')).toBe(
      'Garante ao menos a Sul-Americana',
    );
  });

  it('localizeStake segue o formato da API e aceita subconjunto de locales', () => {
    expect(localizeStake(makeStake('home', 'advances_with_draw'), ['pt-BR', 'es-AR'])).toEqual({
      team: 'home',
      code: 'advances_with_draw',
      text: { 'pt-BR': 'Avança com empate', 'es-AR': 'Avanza con el empate' },
    });
    expect(isStakeLocale('es-UY')).toBe(true);
    expect(isStakeLocale('en')).toBe(false);
  });
});

describe('final: variantes de título', () => {
  const TITLE_FAMILIES = Object.values(TITLE_VARIANT_OF);

  it('nenhum rótulo de título fala em avançar ou vaga, nos 8 mercados', () => {
    for (const locale of STAKE_LOCALES) {
      for (const family of TITLE_FAMILIES) {
        for (const n of [1, 2]) {
          const params = exampleParams(family) ? { n } : undefined;
          const text = stakeText(makeStake('home', family, params), locale);
          expect(text, `${locale} ${family}`).toMatch(/t[íi]tulo|campe[ãóo]/i);
          expect(text, `${locale} ${family}`).not.toMatch(/avan[çcz]|vaga|clasifica/i);
        }
      }
    }
  });

  it.each([
    [
      'needs_win_for_title',
      undefined,
      'Vitória no tempo normal dá o título',
      'Si gana en el tiempo reglamentario, es campeón',
    ],
    ['wins_title_with_draw', undefined, 'Empate dá o título', 'Con el empate es campeón'],
    [
      'needs_win_by_n_for_title',
      { n: 2 },
      'Vitória por 2 gols ou mais no tempo normal dá o título',
      'Si gana por 2 goles o más en el tiempo reglamentario, es campeón',
    ],
    [
      'wins_title_with_loss_by_n',
      { n: 1 },
      'É campeão mesmo perdendo por até 1 gol de diferença',
      'Es campeón incluso perdiendo por hasta 1 gol de diferencia',
    ],
    [
      'wins_title_with_draw_up_to_n',
      { n: 0 },
      'Empate sem gols dá o título',
      'Con empate sin goles es campeón',
    ],
  ] as const)('%s %j — pt-BR e es-AR', (family, params, pt, es) => {
    const stake = makeStake('home', family, params);
    expect(localizeStake(stake, ['pt-BR', 'es-AR']).text).toEqual({ 'pt-BR': pt, 'es-AR': es });
  });

  it('es-MX: "con una victoria"; demais mercados seguem o es-AR', () => {
    const stake = makeStake('away', 'needs_win_for_title');
    expect(stakeText(stake, 'es-MX')).toBe('Con una victoria en el tiempo reglamentario es campeón');
    expect(stakeText(stake, 'es-CO')).toBe(stakeText(stake, 'es-AR'));
  });

  it.each([
    ['needs_win_for_title', {}, 'needs_win_for_title'],
    ['needs_win_by_n_for_title', { n: 2 }, 'needs_win_by_2_for_title'],
    ['wins_title_with_loss_by_n', { n: 1 }, 'wins_title_with_loss_by_1'],
    ['wins_title_with_draw_up_to_n', { n: 0 }, 'wins_title_with_draw_up_to_0'],
    ['wins_title_with_draw_from_n', { n: 2 }, 'wins_title_with_draw_from_2'],
    ['title_depends_on_away_goals', { n: 1 }, 'win_by_1_title_depends_on_away_goals'],
  ] as const)('código %s %j → %s', (family, params, code) => {
    expect(stakeCode(family, params)).toBe(code);
  });
});

describe('códigos', () => {
  it.each([
    ['needs_win_by_n', { n: 2 }, 'needs_win_by_2'],
    ['advances_with_loss_by_n', { n: 1 }, 'advances_with_loss_by_1'],
    ['win_by_n_goes_to_penalties', { n: 1 }, 'win_by_1_goes_to_penalties'],
    ['specific_draw_goes_to_extra_time', { n: 0 }, 'draw_0_0_goes_to_extra_time'],
    ['outcome_depends_on_away_goals', { n: 1 }, 'win_by_1_depends_on_away_goals'],
    ['qualifies_for_zone', { zone: 'sudamericana' }, 'qualifies_for_sudamericana'],
    ['clinches_zone_with_win', { zone: 'round_of_16' }, 'clinches_round_of_16_with_win'],
    ['can_clinch_zone', { zone: 'round_of_16' }, 'can_clinch_round_of_16'],
    ['can_qualify_for_zone', { zone: 'round_of_16' }, 'can_qualify_for_round_of_16'],
    ['mathematically_champion', {}, 'mathematically_champion'],
  ] as const)('%s %j → %s', (family, params, code) => {
    expect(stakeCode(family, params)).toBe(code);
  });

  it('família parametrizada sem parâmetro é erro de programação', () => {
    expect(() => stakeCode('needs_win_by_n')).toThrow(/parâmetro n/);
    expect(() => stakeCode('qualifies_for_zone', { n: 1 })).toThrow(/parâmetro zone/);
  });

  it('códigos concretos são snake_case estáveis', () => {
    for (const family of STAKE_FAMILIES) {
      expect(makeStake('home', family, exampleParams(family)).code).toMatch(/^[a-z0-9_]+$/);
    }
  });
});

describe('documentação', () => {
  it('docs/rules/README.md descreve todas as famílias de códigos', () => {
    const readme = readFileSync(new URL('README.md', docsDir), 'utf8');
    for (const family of STAKE_FAMILIES) expect(readme, family).toContain(`\`${family}\``);
  });

  it('docs/rules/rotulos.md está em dia com labels.ts (pnpm --filter @galaxie/rules docs:labels)', () => {
    const doc = readFileSync(new URL('rotulos.md', docsDir), 'utf8').replace(/\r\n/g, '\n');
    expect(doc).toBe(renderLabelsMarkdown());
  });
});
