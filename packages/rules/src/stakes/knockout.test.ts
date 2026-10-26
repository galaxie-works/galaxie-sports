import { beforeAll, describe, expect, it } from 'vitest';
import { loadCompetitionRules } from '../config/loader.js';
import { knockoutStageRules } from '../config/parse.js';
import type { CompetitionRules, KnockoutStageRules } from '../config/types.js';
import { randInt, rng } from '../test-helpers.js';
import { TITLE_VARIANT_OF, type Stake } from './codes.js';
import { KnockoutInputError, knockoutStakes, tieOutcome, type KnockoutMatchInput } from './knockout.js';
import { localizeStake } from './labels.js';

let LIB24: CompetitionRules;
let LIB19: CompetitionRules;
let LIB17: CompetitionRules;
let UCL24: CompetitionRules;
let UCL19: CompetitionRules;
let CDB: CompetitionRules;
beforeAll(async () => {
  LIB24 = await loadCompetitionRules('conmebol-libertadores', { season: 2024 });
  LIB19 = await loadCompetitionRules('conmebol-libertadores', { season: 2019 });
  LIB17 = await loadCompetitionRules('conmebol-libertadores', { season: 2017 });
  UCL24 = await loadCompetitionRules('uefa-champions-league', { season: 2024 });
  UCL19 = await loadCompetitionRules('uefa-champions-league', { season: 2019 });
  CDB = await loadCompetitionRules('copa-do-brasil', { season: 2024 });
});

const codes = (stakes: Stake[]) => stakes.map((s) => `${s.team}:${s.code}`);

function secondLeg(
  rules: KnockoutStageRules,
  firstLegHome: number,
  firstLegAway: number,
): KnockoutMatchInput {
  return { rules, leg: 2, firstLeg: { homeGoals: firstLegHome, awayGoals: firstLegAway } };
}

describe('docs/07 §2.3 — exemplo do jogo de volta da Libertadores', () => {
  // Palmeiras venceu a ida por 2 × 1 fora de casa e decide em casa na volta.
  it('mandante avança com empate; visitante precisa vencer por 2; vitória por 1 leva aos pênaltis', () => {
    const stakes = knockoutStakes(secondLeg(knockoutStageRules(LIB24, 'semi_final'), 1, 2));
    expect(stakes).toEqual([
      { team: 'home', code: 'advances_with_draw', family: 'advances_with_draw' },
      { team: 'away', code: 'needs_win_by_2', family: 'needs_win_by_n', params: { n: 2 } },
      {
        team: 'away',
        code: 'win_by_1_goes_to_penalties',
        family: 'win_by_n_goes_to_penalties',
        params: { n: 1 },
      },
    ]);
  });

  it('textos pt-BR iguais ao exemplo de evento da API (docs/05 §3.2)', () => {
    const stakes = knockoutStakes(secondLeg(knockoutStageRules(LIB24, 'semi_final'), 1, 2));
    expect(stakes.map((s) => localizeStake(s, ['pt-BR']))).toEqual([
      { team: 'home', code: 'advances_with_draw', text: { 'pt-BR': 'Avança com empate' } },
      {
        team: 'away',
        code: 'needs_win_by_2',
        text: { 'pt-BR': 'Precisa vencer por 2 gols para avançar direto' },
      },
      {
        team: 'away',
        code: 'win_by_1_goes_to_penalties',
        text: { 'pt-BR': 'Vitória por 1 gol leva a decisão aos pênaltis' },
      },
    ]);
  });
});

describe('knockoutStakes — tabela de casos', () => {
  type Case = [string, () => KnockoutMatchInput, string[]];
  const cases: Case[] = [
    [
      'Libertadores: agregado igual (1 × 1) → ambos precisam vencer, empate vai aos pênaltis',
      () => secondLeg(LIB24.knockout!.default, 1, 1),
      ['home:needs_win', 'away:needs_win', 'both:draw_goes_to_penalties'],
    ],
    [
      'Champions: agregado igual → empate leva à prorrogação, depois pênaltis',
      () => secondLeg(UCL24.knockout!.default, 2, 2),
      ['home:needs_win', 'away:needs_win', 'both:draw_goes_to_extra_time', 'both:extra_time_then_penalties'],
    ],
    [
      'Champions: mandante da volta perdeu a ida por 1 → precisa de 2 gols de diferença ou prorrogação',
      () => secondLeg(UCL24.knockout!.default, 1, 0),
      [
        'home:needs_win_by_2',
        'home:win_by_1_goes_to_extra_time',
        'away:advances_with_draw',
        'both:extra_time_then_penalties',
      ],
    ],
    [
      'vantagem de 3 gols na ida (0 × 3) → pode perder por até 2',
      () => secondLeg(LIB24.knockout!.default, 0, 3),
      ['home:advances_with_loss_by_2', 'away:needs_win_by_4', 'away:win_by_3_goes_to_penalties'],
    ],
    [
      'goleada na ida (5 × 0 para o visitante da volta)',
      () => secondLeg(LIB24.knockout!.default, 5, 0),
      ['home:needs_win_by_6', 'home:win_by_5_goes_to_penalties', 'away:advances_with_loss_by_4'],
    ],
    [
      'gol fora (Libertadores 2019), ida 1 × 1: 0 × 0 classifica o mandante, 2 × 2 o visitante, 1 × 1 vai aos pênaltis',
      () => secondLeg(LIB19.knockout!.default, 1, 1),
      [
        'home:advances_with_draw_up_to_0',
        'away:advances_with_draw_from_2',
        'both:draw_1_1_goes_to_penalties',
        'both:away_goals_rule',
      ],
    ],
    [
      'gol fora (Libertadores 2019), ida 2 × 1: vitória por 1 depende dos gols fora',
      () => secondLeg(LIB19.knockout!.default, 2, 1),
      [
        'home:needs_win_by_2',
        'home:win_by_1_depends_on_away_goals',
        'away:advances_with_draw',
        'both:away_goals_rule',
      ],
    ],
    [
      'gol fora com prorrogação (Champions 2019), ida 0 × 0: empate com gols classifica o visitante',
      () => secondLeg(UCL19.knockout!.default, 0, 0),
      [
        'home:needs_win',
        'away:advances_with_draw_from_1',
        'both:draw_0_0_goes_to_extra_time',
        'both:away_goals_rule',
        'both:extra_time_then_penalties',
      ],
    ],
    [
      'final em jogo único (Libertadores 2024)',
      () => ({ rules: knockoutStageRules(LIB24, 'final') }),
      [
        'home:needs_win_for_title',
        'away:needs_win_for_title',
        'both:draw_goes_to_extra_time',
        'both:extra_time_then_penalties',
        'both:decides_title',
      ],
    ],
    [
      'Copa do Brasil 1ª fase: visitante avança com empate',
      () => ({ rules: knockoutStageRules(CDB, 'first_round') }),
      ['home:needs_win', 'away:advances_with_draw'],
    ],
    [
      'Copa do Brasil 2ª fase: jogo único, empate vai direto aos pênaltis',
      () => ({ rules: knockoutStageRules(CDB, 'second_round') }),
      ['home:needs_win', 'away:needs_win', 'both:draw_goes_to_penalties'],
    ],
    [
      'Copa do Brasil final, volta: vale o título',
      () => secondLeg(knockoutStageRules(CDB, 'final'), 0, 1),
      [
        'home:wins_title_with_draw',
        'away:needs_win_by_2_for_title',
        'away:win_by_1_goes_to_penalties',
        'both:decides_title',
      ],
    ],
    ['jogo de ida (2024)', () => ({ rules: LIB24.knockout!.default, leg: 1 }), ['both:first_leg']],
    [
      'jogo de ida com gol fora (2019)',
      () => ({ rules: LIB19.knockout!.default, leg: 1 }),
      ['both:first_leg', 'both:away_goals_rule'],
    ],
    [
      'Libertadores 2017: final de ida e volta (volta) sem gol fora, com prorrogação',
      () => secondLeg(knockoutStageRules(LIB17, 'final'), 1, 1),
      [
        'home:needs_win_for_title',
        'away:needs_win_for_title',
        'both:draw_goes_to_extra_time',
        'both:extra_time_then_penalties',
        'both:decides_title',
      ],
    ],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(codes(knockoutStakes(input()))).toEqual(expected);
  });
});

describe('final: quem vence é campeão (variantes de título)', () => {
  const texts = (stakes: Stake[], locale: 'pt-BR' | 'es-AR') =>
    stakes.map((s) => `${s.team}:${localizeStake(s, [locale]).text[locale]}`);

  it('final em jogo único (Palmeiras × Estudiantes, Libertadores 2026): nada de "avançar"', async () => {
    const LIB26 = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
    const stakes = knockoutStakes({ rules: knockoutStageRules(LIB26, 'final') });
    expect(codes(stakes)).toEqual([
      'home:needs_win_for_title',
      'away:needs_win_for_title',
      'both:draw_goes_to_extra_time',
      'both:extra_time_then_penalties',
      'both:decides_title',
    ]);
    expect(texts(stakes, 'pt-BR')).toEqual([
      'home:Vitória no tempo normal dá o título',
      'away:Vitória no tempo normal dá o título',
      'both:Empate leva o jogo à prorrogação',
      'both:Em caso de igualdade, prorrogação e depois pênaltis',
      'both:Vale o título',
    ]);
    expect(texts(stakes, 'es-AR')).toEqual([
      'home:Si gana en el tiempo reglamentario, es campeón',
      'away:Si gana en el tiempo reglamentario, es campeón',
      'both:El empate lleva el partido al alargue',
      'both:Si hay igualdad, alargue y después penales',
      'both:Se define el campeón',
    ]);
    for (const locale of ['pt-BR', 'es-AR'] as const) {
      for (const t of texts(stakes, locale)) expect(t).not.toMatch(/avan[çc]|vaga|clasifica/i);
    }
  });

  it('final em ida e volta (Copa do Brasil, volta): empate e margem dão o título', () => {
    const stakes = knockoutStakes(secondLeg(knockoutStageRules(CDB, 'final'), 0, 1));
    expect(texts(stakes, 'pt-BR')).toEqual([
      'home:Empate dá o título',
      'away:Vitória por 2 gols ou mais no tempo normal dá o título',
      'away:Vitória por 1 gol leva a decisão aos pênaltis',
      'both:Vale o título',
    ]);
    expect(texts(stakes, 'es-AR')).toEqual([
      'home:Con el empate es campeón',
      'away:Si gana por 2 goles o más en el tiempo reglamentario, es campeón',
      'away:Ganar por 1 gol lleva la definición a los penales',
      'both:Se define el campeón',
    ]);
  });

  it('final em ida e volta: vantagem larga vira "é campeão mesmo perdendo"', () => {
    const stakes = knockoutStakes(secondLeg(knockoutStageRules(CDB, 'final'), 0, 3));
    expect(codes(stakes)).toEqual([
      'home:wins_title_with_loss_by_2',
      'away:needs_win_by_4_for_title',
      'away:win_by_3_goes_to_penalties',
      'both:decides_title',
    ]);
    expect(localizeStake(stakes[0]!, ['pt-BR']).text['pt-BR']).toBe(
      'É campeão mesmo perdendo por até 2 gols de diferença',
    );
  });

  it('final com gol fora (Libertadores 2017 não tinha; regra sintética): empates e margens de título', () => {
    const rules = { ...LIB19.knockout!.default, decidesTitle: true };
    expect(codes(knockoutStakes(secondLeg(rules, 1, 1)))).toEqual([
      'home:wins_title_with_draw_up_to_0',
      'away:wins_title_with_draw_from_2',
      'both:draw_1_1_goes_to_penalties',
      'both:away_goals_rule',
      'both:decides_title',
    ]);
    expect(codes(knockoutStakes(secondLeg(rules, 2, 1)))).toEqual([
      'home:needs_win_by_2_for_title',
      'home:win_by_1_title_depends_on_away_goals',
      'away:wins_title_with_draw',
      'both:away_goals_rule',
      'both:decides_title',
    ]);
  });

  it('ida da final não decide nada: só first_leg (sem variantes)', () => {
    expect(codes(knockoutStakes({ rules: knockoutStageRules(CDB, 'final'), leg: 1 }))).toEqual([
      'both:first_leg',
    ]);
  });

  it('fora da final os códigos de "avançar" seguem como estão (contrato da API)', () => {
    const stakes = knockoutStakes(secondLeg(knockoutStageRules(LIB24, 'semi_final'), 1, 2));
    expect(codes(stakes)).toEqual([
      'home:advances_with_draw',
      'away:needs_win_by_2',
      'away:win_by_1_goes_to_penalties',
    ]);
  });
});

describe('tieOutcome — quem passa com o placar atual (ao vivo)', () => {
  it.each([
    [1, 2, 0, 0, 'home'],
    [1, 2, 0, 1, 'penalties'],
    [1, 2, 0, 2, 'away'],
    [1, 2, 3, 3, 'home'],
    [0, 0, 0, 0, 'penalties'],
  ] as const)('Libertadores 2024: ida %i × %i, volta %i × %i → %s', (h1, a1, h2, a2, expected) => {
    expect(tieOutcome(secondLeg(LIB24.knockout!.default, h1, a1), h2, a2)).toBe(expected);
  });

  it.each([
    [2, 1, 1, 0, 'home'],
    [2, 1, 2, 1, 'extra_time'],
    [2, 1, 3, 2, 'away'],
    [0, 0, 1, 1, 'away'],
  ] as const)('Champions 2019 (gol fora): ida %i × %i, volta %i × %i → %s', (h1, a1, h2, a2, expected) => {
    expect(tieOutcome(secondLeg(UCL19.knockout!.default, h1, a1), h2, a2)).toBe(expected);
  });

  it('campo neutro anula o gol fora', () => {
    const rules = { ...LIB19.knockout!.default, neutralVenue: true };
    expect(tieOutcome(secondLeg(rules, 2, 1), 2, 1)).toBe('penalties');
    expect(codes(knockoutStakes({ rules, leg: 1 }))).toEqual(['both:first_leg']);
  });
});

describe('erros de entrada', () => {
  it.each([
    ['ida e volta sem leg', () => knockoutStakes({ rules: LIB24.knockout!.default }), /leg = 1 ou 2/],
    ['volta sem placar da ida', () => knockoutStakes({ rules: LIB24.knockout!.default, leg: 2 }), /firstLeg/],
    [
      'tieOutcome no jogo de ida',
      () => tieOutcome({ rules: LIB24.knockout!.default, leg: 1 }, 0, 0),
      /ida não decide/,
    ],
    ['gols negativos', () => tieOutcome(secondLeg(LIB24.knockout!.default, 0, 0), -1, 0), /homeGoals/],
    [
      'placar da ida inválido',
      () => tieOutcome(secondLeg(LIB24.knockout!.default, 0, 1.5), 0, 0),
      /firstLeg/,
    ],
  ])('%s', (_n, fn, msg) => {
    expect(fn).toThrow(KnockoutInputError);
    expect(fn).toThrow(msg);
  });
});

/** Variante de título → família-base (mesma condição). */
const BASE_OF_TITLE: Record<string, string> = Object.fromEntries(
  Object.entries(TITLE_VARIANT_OF).map(([base, title]) => [title, base]),
);

describe('propriedade: todo código emitido é verdadeiro por força bruta', () => {
  const PRIMARY = new Set([
    'advances_with_draw',
    'advances_with_loss_by_n',
    'needs_win',
    'needs_win_by_n',
    'advances_with_draw_up_to_n',
    'advances_with_draw_from_n',
  ]);
  const G = 6;
  /** Todos os placares (h, a) com h − a = margem do ponto de vista do lado. */
  function scores(side: 'home' | 'away', margin: number): [number, number][] {
    const out: [number, number][] = [];
    for (let loser = 0; loser <= G; loser++) {
      const mine = margin >= 0 ? loser + margin : loser;
      const theirs = margin >= 0 ? loser : loser - margin;
      out.push(side === 'home' ? [mine, theirs] : [theirs, mine]);
    }
    return out;
  }

  it.each(Array.from({ length: 60 }, (_, i) => i + 1))('semente %i', (seed) => {
    const rand = rng(seed);
    const rules: KnockoutStageRules = {
      legs: rand() < 0.2 ? 1 : 2,
      awayGoals: rand() < 0.5,
      awayGoalsInExtraTime: false,
      extraTime: rand() < 0.5,
      penalties: true,
      drawAdvantage: null,
      neutralVenue: false,
      decidesTitle: rand() < 0.5,
      levelAdvantage: null,
    };
    const input: KnockoutMatchInput =
      rules.legs === 1 ? { rules } : secondLeg(rules, randInt(rand, 4), randInt(rand, 4));
    const stakes = knockoutStakes(input);
    const out = (h: number, a: number) => tieOutcome(input, h, a);
    for (const side of ['home', 'away'] as const) {
      const mine = stakes.filter((s) => s.team === side);
      expect(
        mine.filter((s) => PRIMARY.has(BASE_OF_TITLE[s.family] ?? s.family)).length,
        `${side} ${JSON.stringify(stakes)}`,
      ).toBe(1);
      for (const s of mine) {
        const n = s.params?.n ?? 0;
        // a variante de título tem exatamente a condição da família-base
        const isTitle = s.family in BASE_OF_TITLE;
        expect(isTitle, `${s.family} com decidesTitle=${rules.decidesTitle}`).toBe(
          rules.decidesTitle && Object.values(TITLE_VARIANT_OF).includes(s.family as never),
        );
        const family = BASE_OF_TITLE[s.family] ?? s.family;
        switch (family) {
          case 'advances_with_draw':
            for (const [h, a] of scores(side, 0)) expect(out(h, a)).toBe(side);
            expect(scores(side, -1).some(([h, a]) => out(h, a) !== side)).toBe(true);
            break;
          case 'advances_with_loss_by_n':
            for (const [h, a] of scores(side, -n)) expect(out(h, a)).toBe(side);
            expect(scores(side, -n - 1).some(([h, a]) => out(h, a) !== side)).toBe(true);
            break;
          case 'needs_win':
          case 'needs_win_by_n': {
            const need = family === 'needs_win' ? 1 : n;
            for (const [h, a] of scores(side, need)) expect(out(h, a)).toBe(side);
            expect(scores(side, need - 1).some(([h, a]) => out(h, a) !== side)).toBe(true);
            break;
          }
          case 'win_by_n_goes_to_penalties':
            for (const [h, a] of scores(side, n)) expect(out(h, a)).toBe('penalties');
            break;
          case 'win_by_n_goes_to_extra_time':
            for (const [h, a] of scores(side, n)) expect(out(h, a)).toBe('extra_time');
            break;
          case 'advances_with_draw_up_to_n':
            for (let g = 0; g <= n; g++) expect(out(g, g)).toBe(side);
            expect(out(n + 1, n + 1)).not.toBe(side);
            break;
          case 'advances_with_draw_from_n':
            for (let g = n; g <= G; g++) expect(out(g, g)).toBe(side);
            if (n > 0) expect(out(n - 1, n - 1)).not.toBe(side);
            break;
          case 'outcome_depends_on_away_goals':
            expect(new Set(scores(side, n).map(([h, a]) => out(h, a))).size).toBeGreaterThan(1);
            break;
          default:
            throw new Error(`família inesperada para ${side}: ${s.family}`);
        }
      }
    }
    for (const s of stakes.filter((x) => x.team === 'both')) {
      if (s.family === 'draw_goes_to_penalties')
        for (const [h, a] of scores('home', 0)) expect(out(h, a)).toBe('penalties');
      if (s.family === 'draw_goes_to_extra_time')
        for (const [h, a] of scores('home', 0)) expect(out(h, a)).toBe('extra_time');
      if (s.family === 'specific_draw_goes_to_penalties')
        expect(out(s.params!.n!, s.params!.n!)).toBe('penalties');
      if (s.family === 'specific_draw_goes_to_extra_time')
        expect(out(s.params!.n!, s.params!.n!)).toBe('extra_time');
    }
  });
});

describe('Liguilla (Liga MX): empate no agregado classifica o de melhor campanha', () => {
  let MX: CompetitionRules;
  beforeAll(async () => {
    MX = await loadCompetitionRules('liga-mx', { season: 2025 });
  });

  it('quartas e semifinal decididas pela campanha; final com prorrogação e pênaltis', () => {
    const quarter = knockoutStageRules(MX, 'quarter_final');
    expect(quarter).toMatchObject({
      legs: 2,
      extraTime: false,
      penalties: false,
      levelAdvantage: 'better_seed',
    });
    expect(knockoutStageRules(MX, 'final')).toMatchObject({
      extraTime: true,
      penalties: true,
      levelAdvantage: null,
      decidesTitle: true,
    });
    expect(MX.knockout!.seeding.map((s) => s.table)).toEqual(['apertura', 'clausura']);
  });

  it('volta com agregado empatado: passa o mais bem colocado (mandante 2º contra visitante 7º)', () => {
    const rules = knockoutStageRules(MX, 'quarter_final');
    // ida 1 × 1 (o visitante da volta jogou em casa); a volta empatada mantém o agregado igual
    const input: KnockoutMatchInput = { ...secondLeg(rules, 1, 1), seed: { home: 2, away: 7 } };
    expect(tieOutcome(input, 0, 0)).toBe('home');
    expect(tieOutcome(input, 2, 2)).toBe('home');
    expect(tieOutcome(input, 0, 1)).toBe('away');
    const stakes = codes(knockoutStakes(input));
    expect(stakes).toContain('home:advances_with_draw');
    expect(stakes).toContain('away:needs_win');
    expect(stakes.some((c) => c.includes('penalties') || c.includes('extra_time'))).toBe(false);
  });

  it('o mais bem colocado como visitante também passa com o empate', () => {
    const rules = knockoutStageRules(MX, 'semi_final');
    const input: KnockoutMatchInput = { ...secondLeg(rules, 0, 0), seed: { home: 6, away: 1 } };
    expect(tieOutcome(input, 1, 1)).toBe('away');
    expect(codes(knockoutStakes(input))).toContain('away:advances_with_draw');
  });

  it('sem a posição dos dois, o empate não é atribuído a ninguém pela campanha', () => {
    const rules = knockoutStageRules(MX, 'quarter_final');
    expect(tieOutcome(secondLeg(rules, 1, 1), 0, 0)).toBe('penalties');
  });
});
