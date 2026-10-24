import { describe, expect, it } from 'vitest';
import { loadCompetitionRules } from '../config/loader.js';
import { knockoutStageRules } from '../config/parse.js';
import { makeStake } from './codes.js';
import { fanTags } from './fan-tags.js';
import { knockoutStakes } from './knockout.js';
import { localizeStake, STAKE_LOCALES, stakeText } from './labels.js';
import { championPhrase, titleChaseSides, titleChaseStakes, titleOrdinal } from './titles.js';

describe('titleOrdinal', () => {
  it.each([
    [1, 'primeiro título', 'primer título'],
    [2, 'bicampeonato', 'bicampeonato'],
    [3, 'tricampeonato', 'tricampeonato'],
    [4, 'tetracampeonato', 'tetracampeonato'],
    [5, 'pentacampeonato', 'pentacampeonato'],
    [6, 'hexacampeonato', 'hexacampeonato'],
    [7, 'heptacampeonato', 'heptacampeonato'],
    [8, 'octacampeonato', 'octacampeonato'],
    [9, 'eneacampeonato', 'eneacampeonato'],
    [10, 'decacampeonato', 'decacampeonato'],
    [11, '11º título', 'título número 11'],
    [34, '34º título', 'título número 34'],
  ])('%i → %s / %s', (n, pt, es) => {
    expect(titleOrdinal(n, 'pt')).toBe(pt);
    expect(titleOrdinal(n, 'es')).toBe(es);
  });

  it('forma curta das tags', () => {
    expect(titleOrdinal(4, 'pt', true)).toBe('tetra');
    expect(titleOrdinal(5, 'es', true)).toBe('penta');
    expect(titleOrdinal(12, 'pt', true)).toBe('12º título');
    expect(titleOrdinal(12, 'es', true)).toBe('título 12');
  });
});

describe('seeks_title_n — rótulos', () => {
  it('Palmeiras (3 Libertadores) e Estudiantes (4): tetra e penta', () => {
    const stakes = titleChaseStakes(['home', 'away'], { home: { won: 3 }, away: { won: 4 } });
    expect(stakes.map((s) => s.code)).toEqual(['seeks_title_4', 'seeks_title_5']);
    expect(stakes.map((s) => localizeStake(s, ['pt-BR', 'es-AR']).text)).toEqual([
      { 'pt-BR': 'Busca o tetracampeonato', 'es-AR': 'Va por el tetracampeonato' },
      { 'pt-BR': 'Busca o pentacampeonato', 'es-AR': 'Va por el pentacampeonato' },
    ]);
  });

  it.each([
    [0, 'Busca o primeiro título', 'Va por su primer título'],
    [1, 'Busca o bicampeonato', 'Va por el bicampeonato'],
    [9, 'Busca o decacampeonato', 'Va por el decacampeonato'],
    [10, 'Busca o 11º título', 'Va por el título número 11'],
  ])('já tem %i → %s', (won, pt, es) => {
    const [stake] = titleChaseStakes(['home'], { home: { won } });
    expect(stakeText(stake!, 'pt-BR')).toBe(pt);
    expect(stakeText(stake!, 'es-AR')).toBe(es);
  });

  it('texto nos 8 mercados, sem placeholder sobrando', () => {
    for (const n of [1, 2, 4, 10, 11, 30]) {
      const stake = makeStake('home', 'seeks_title_n', { n });
      for (const locale of STAKE_LOCALES) expect(stakeText(stake, locale)).not.toMatch(/[{}]/);
    }
  });

  it('tag do torcedor curta, na faixa de título, depois de "Vale o título" e "Precisa vencer"', async () => {
    const LIB26 = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
    const stakes = [
      ...knockoutStakes({ rules: knockoutStageRules(LIB26, 'final') }),
      ...titleChaseStakes(['home', 'away'], { home: { won: 3 }, away: { won: 4 } }),
    ];
    expect(fanTags(stakes, 'home', ['pt-BR', 'es-AR']).map((t) => t.text)).toEqual([
      { 'pt-BR': 'Vale o título', 'es-AR': 'Se juega el título' },
      { 'pt-BR': 'Precisa vencer', 'es-AR': 'Necesita ganar' },
      { 'pt-BR': 'Busca o tetra', 'es-AR': 'Va por el tetra' },
    ]);
    expect(fanTags(stakes, 'away', ['pt-BR'])[2]!.text['pt-BR']).toBe('Busca o penta');
    expect(fanTags(stakes, 'away', ['pt-BR'])[2]!.text['pt-BR']!.length).toBeLessThanOrEqual(30);
  });
});

describe('titleChaseSides — quando emitir', () => {
  it('final (decidesTitle): os dois lados, ida inclusive', () => {
    expect(titleChaseSides([makeStake('both', 'first_leg')], { decidesTitle: true })).toEqual([
      'home',
      'away',
    ]);
    expect(titleChaseSides([makeStake('both', 'decides_title')])).toEqual(['home', 'away']);
  });

  it('pontos corridos: só quem pode ser campeão na rodada', () => {
    expect(
      titleChaseSides([makeStake('home', 'clinches_title_with_win'), makeStake('away', 'in_title_race')]),
    ).toEqual(['home']);
    expect(titleChaseSides([makeStake('away', 'can_clinch_title')])).toEqual(['away']);
    expect(titleChaseSides([makeStake('home', 'in_title_race')])).toEqual([]);
  });

  it('semifinal e jogo comum: ninguém', () => {
    expect(titleChaseSides([makeStake('home', 'needs_win')], { decidesTitle: false })).toEqual([]);
    expect(titleChaseSides([])).toEqual([]);
  });

  it('sem contagem confiável para um lado, só o outro sai', () => {
    expect(titleChaseStakes(['home', 'away'], { away: { won: 4 } }).map((s) => s.code)).toEqual([
      'seeks_title_5',
    ]);
    expect(titleChaseStakes(['away'], { home: { won: 3 }, away: { won: 4 } }).map((s) => s.team)).toEqual([
      'away',
    ]);
    expect(titleChaseStakes(['home'], { home: { won: -1 } })).toEqual([]);
  });
});

describe('championPhrase — resumo pós-jogo', () => {
  it.each([
    [1, 'é campeão pela primeira vez', 'es campeón por primera vez'],
    [2, 'é bicampeão', 'es bicampeón'],
    [4, 'é tetracampeão', 'es tetracampeón'],
    [10, 'é decacampeão', 'es decacampeón'],
    [11, 'conquista o 11º título', 'gana su título número 11'],
  ])('%i → %s / %s', (n, pt, es) => {
    expect(championPhrase(n, 'pt')).toBe(pt);
    expect(championPhrase(n, 'es')).toBe(es);
  });
});
