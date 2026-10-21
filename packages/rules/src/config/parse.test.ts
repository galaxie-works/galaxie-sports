import { describe, expect, it } from 'vitest';
import { deepMerge, knockoutStageRules, parseCompetitionRules, RulesConfigError } from './parse.js';

describe('parseCompetitionRules — padrões', () => {
  it('preenche pontuação 3/1/0, desempates genéricos e mata-mata padrão', () => {
    const r = parseCompetitionRules({ slug: 'x', knockout: {} });
    expect(r.format).toBe('league');
    expect(r.name).toBe('x');
    expect(r.season).toBeNull();
    expect(r.standings.points).toEqual({ win: 3, draw: 1, loss: 0 });
    expect(r.standings.tieBreakers.map((t) => t.criterion)).toEqual([
      'goal_difference',
      'goals_for',
      'wins',
      'drawing_of_lots',
    ]);
    expect(r.standings.h2hReapply).toBe(true);
    expect(r.standings.fairPlay).toEqual({ yellow: 1, red: 3 });
    expect(r.league).toBeNull();
    expect(r.knockout?.default).toMatchObject({ legs: 2, awayGoals: false, extraTime: true, penalties: true });
  });

  it('aceita critério como string ou objeto com max_teams/require_complete', () => {
    const r = parseCompetitionRules({
      slug: 'x',
      standings: {
        tie_breakers: ['wins', { criterion: 'h2h_points', max_teams: 2, require_complete: true }],
      },
    });
    expect(r.standings.tieBreakers).toEqual([
      { criterion: 'wins' },
      { criterion: 'h2h_points', maxTeams: 2, requireComplete: true },
    ]);
  });

  it('normaliza liga e zonas', () => {
    const r = parseCompetitionRules({
      slug: 'x',
      league: { teams: 4, matches_per_team: 6, zones: [{ id: 'round_of_16', kind: 'qualification', from: 1, to: 2 }] },
    });
    expect(r.league).toEqual({
      teams: 4,
      matchesPerTeam: 6,
      meetingsPerPair: 2,
      title: true,
      zones: [{ id: 'round_of_16', kind: 'qualification', from: 1, to: 2 }],
    });
  });
});

describe('parseCompetitionRules — validação', () => {
  const cases: [string, unknown, RegExp][] = [
    ['não-objeto', 'abc', /esperado um objeto/],
    ['slug ausente', {}, /slug ausente/],
    ['slug fora do padrão', { slug: 'Brasileirão' }, /slug/],
    ['formato inválido', { slug: 'x', format: 'torneio' }, /format inválido/],
    ['critério desconhecido', { slug: 'x', standings: { tie_breakers: ['sorte'] } }, /desconhecido/],
    ['pontos não inteiros', { slug: 'x', standings: { points: { win: 2.5 } } }, /inteiro/],
    ['zona sem id', { slug: 'x', league: { zones: [{ kind: 'relegation', from: 1, to: 2 }] } }, /id de zona/],
    [
      'tipo de zona',
      { slug: 'x', league: { zones: [{ id: 'z', kind: 'rebaixa', from: 1, to: 2 }] } },
      /tipo de zona/,
    ],
    [
      'faixa invertida',
      { slug: 'x', league: { zones: [{ id: 'z', kind: 'relegation', from: 5, to: 2 }] } },
      /faixa 5–2/,
    ],
    [
      'zona além dos times',
      { slug: 'x', league: { teams: 4, zones: [{ id: 'z', kind: 'relegation', from: 4, to: 5 }] } },
      /passa do número de times/,
    ],
    [
      'zona duplicada',
      {
        slug: 'x',
        league: {
          zones: [
            { id: 'z', kind: 'relegation', from: 4, to: 5 },
            { id: 'z', kind: 'relegation', from: 6, to: 7 },
          ],
        },
      },
      /duplicada/,
    ],
    ['legs inválido', { slug: 'x', knockout: { default: { legs: 3 } } }, /legs deve ser 1 ou 2/],
    [
      'vantagem do empate em ida e volta',
      { slug: 'x', knockout: { default: { legs: 2, draw_advantage: 'away' } } },
      /só vale para jogo único/,
    ],
    [
      'empate sem decisão',
      { slug: 'x', knockout: { default: { legs: 1, extra_time: false, penalties: false } } },
      /não há como decidir/,
    ],
    ['override sem seasons', { slug: 'x', overrides: [{ league: null }] }, /seasons/],
  ];
  it.each(cases)('%s', (_name, raw, message) => {
    expect(() => parseCompetitionRules(raw, { season: 2024 })).toThrow(RulesConfigError);
    expect(() => parseCompetitionRules(raw, { season: 2024 })).toThrow(message);
  });
});

describe('overrides por temporada', () => {
  const raw = {
    slug: 'copa',
    knockout: { default: { legs: 2, away_goals: false }, stages: { final: { legs: 1 } } },
    overrides: [
      { seasons: { to: 2021 }, knockout: { default: { away_goals: true } } },
      { seasons: { from: 2010, to: 2018 }, knockout: { stages: { final: { legs: 2 } } } },
    ],
  };

  it.each([
    [2024, false, 1],
    [2022, false, 1],
    [2021, true, 1],
    [2019, true, 1],
    [2018, true, 2],
    [2010, true, 2],
    [2009, true, 1],
  ] as const)('temporada %i: gol fora=%s, final em %i jogo(s)', (season, awayGoals, finalLegs) => {
    const r = parseCompetitionRules(raw, { season });
    expect(r.season).toBe(season);
    expect(r.knockout!.default.awayGoals).toBe(awayGoals);
    expect(knockoutStageRules(r, 'final').legs).toBe(finalLegs);
  });

  it('sem temporada, ignora as exceções', () => {
    expect(parseCompetitionRules(raw).knockout!.default.awayGoals).toBe(false);
  });

  it('fase sem exceção usa o padrão; sem knockout, usa o padrão genérico', () => {
    const r = parseCompetitionRules(raw);
    expect(knockoutStageRules(r, 'semi_final')).toBe(r.knockout!.default);
    expect(knockoutStageRules(r, null)).toBe(r.knockout!.default);
    expect(knockoutStageRules(parseCompetitionRules({ slug: 'liga' })).legs).toBe(2);
  });
});

describe('deepMerge', () => {
  it.each([
    [{ a: 1 }, { b: 2 }, { a: 1, b: 2 }],
    [{ a: { x: 1, y: 2 } }, { a: { y: 3 } }, { a: { x: 1, y: 3 } }],
    [{ a: [1, 2] }, { a: [3] }, { a: [3] }],
    [{ a: { x: 1 } }, { a: null }, { a: null }],
    [{ a: 1 }, undefined, { a: 1 }],
  ])('%j + %j = %j', (base, patch, expected) => {
    expect(deepMerge(base, patch)).toEqual(expected);
  });
});
