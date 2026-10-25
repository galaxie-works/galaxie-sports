import { beforeAll, describe, expect, it } from 'vitest';
import { loadAllCompetitionRules } from '../config/loader.js';
import type { CompetitionRules } from '../config/types.js';
import { match, randInt, randomDoubleRoundRobin, rng, rulesFrom } from '../test-helpers.js';
import { formString, StandingsInputError } from './accumulate.js';
import { computeStandings, computeTable } from './compute.js';
import type { BaselineRow, MatchResult, StandingRow } from './types.js';

let RULES: Map<string, CompetitionRules>;
beforeAll(async () => {
  RULES = await loadAllCompetitionRules({ season: 2024 });
});
const rules = (slug: string) => RULES.get(slug)!;

function row(
  teamId: string,
  w: number,
  d: number,
  l: number,
  gf: number,
  ga: number,
  extra: Partial<BaselineRow> = {},
) {
  return { teamId, played: w + d + l, won: w, drawn: d, lost: l, goalsFor: gf, goalsAgainst: ga, ...extra };
}

const order = (rows: StandingRow[]) => rows.map((r) => r.teamId);

describe('critérios de desempate por competição (empate em pontos)', () => {
  // A: mais vitórias, pior saldo, venceu os dois confrontos diretos. B: melhor saldo.
  const S1 = {
    baseline: [row('A', 15, 5, 18, 40, 35), row('B', 14, 8, 16, 45, 35)],
    priorMatches: [match('A', 'B', 2, 0), match('B', 'A', 0, 1)],
  };
  it.each([
    ['brasileirao-serie-a', ['A', 'B'], 'wins'],
    ['premier-league', ['B', 'A'], 'goal_difference'],
    ['laliga', ['A', 'B'], 'h2h_points'],
    ['serie-a-italia', ['A', 'B'], 'h2h_points'],
    ['bundesliga', ['B', 'A'], 'goal_difference'],
    ['ligue-1', ['B', 'A'], 'goal_difference'],
    ['argentina-liga-profesional', ['B', 'A'], 'goal_difference'],
    ['conmebol-libertadores', ['B', 'A'], 'goal_difference'],
    ['uefa-champions-league', ['B', 'A'], 'goal_difference'],
    ['default', ['B', 'A'], 'goal_difference'],
  ])('S1 vitórias × saldo × confronto direto — %s', (slug, expected, decidedBy) => {
    const t = computeTable({ rules: rules(slug), matches: [], ...S1 });
    expect(order(t)).toEqual(expected);
    expect(t[0]!.points).toBe(50);
    expect(t[1]!.points).toBe(50);
    expect(t[1]!.decidedBy).toBe(decidedBy);
  });

  it('LaLiga só usa confronto direto com todos os jogos entre eles disputados', () => {
    const t = computeTable({
      rules: rules('laliga'),
      matches: [],
      baseline: S1.baseline,
      priorMatches: [S1.priorMatches[0]!],
    });
    expect(order(t)).toEqual(['B', 'A']);
    expect(t[1]!.decidedBy).toBe('goal_difference');
  });

  it('LaLiga: confronto direto incompleto entre os três; separado C pelo saldo, A e B recomeçam e o confronto direto completo entre eles decide', () => {
    // A×B completo (B venceu um, empataram o outro); C não jogou todos contra eles. Saldo geral separa C;
    // A tem mais gols pró que B, mas os critérios voltam ao início para os que seguem empatados
    // (RFEF, art. 201): o confronto direto entre A e B, agora completo, decide.
    const t = computeTable({
      rules: rules('laliga'),
      matches: [],
      baseline: [row('A', 10, 5, 5, 34, 24), row('B', 10, 5, 5, 30, 20), row('C', 10, 5, 5, 40, 20)],
      priorMatches: [match('B', 'A', 1, 0), match('A', 'B', 0, 0), match('C', 'A', 1, 0)],
    });
    expect(order(t)).toEqual(['C', 'B', 'A']);
    expect(t.map((r) => r.decidedBy)).toEqual([null, 'goal_difference', 'h2h_points']);
  });

  // Mesmas vitórias, saldo e gols; B levou a melhor no confronto direto.
  const S2 = {
    baseline: [row('A', 15, 5, 18, 40, 35), row('B', 15, 5, 18, 40, 35)],
    priorMatches: [match('B', 'A', 1, 0), match('A', 'B', 0, 0)],
  };
  it.each([
    ['brasileirao-serie-a', ['B', 'A'], 'h2h_points'],
    ['premier-league', ['B', 'A'], 'h2h_points'],
    ['laliga', ['B', 'A'], 'h2h_points'],
    ['bundesliga', ['B', 'A'], 'h2h_points'],
  ])('S2 confronto direto decide — %s', (slug, expected, decidedBy) => {
    const t = computeTable({ rules: rules(slug), matches: [], ...S2 });
    expect(order(t)).toEqual(expected);
    expect(t[1]!.decidedBy).toBe(decidedBy);
    expect(t[0]!.unresolvedTieWith).toEqual([]);
  });

  it('S2 sem confronto direto no regulamento: sorteio determinístico, empate sinalizado', () => {
    const t = computeTable({ rules: rules('default'), matches: [], ...S2 });
    expect(order(t)).toEqual(['A', 'B']);
    expect(t[0]!.unresolvedTieWith).toEqual(['B']);
    expect(t[1]!.unresolvedTieWith).toEqual(['A']);
    expect(t[1]!.decidedBy).toBe('drawing_of_lots');
  });

  // Tudo igual, confronto direto empatado; A sem vermelhos (mas mais amarelos); B com fair play melhor.
  const S3 = {
    baseline: [
      row('A', 15, 5, 18, 40, 35, { redCards: 0, yellowCards: 10 }),
      row('B', 15, 5, 18, 40, 35, { redCards: 2, yellowCards: 2 }),
    ],
    priorMatches: [match('A', 'B', 1, 0), match('B', 'A', 1, 0)],
  };
  it.each([
    ['brasileirao-serie-a', ['A', 'B'], 'fewest_red_cards'],
    ['conmebol-libertadores', ['A', 'B'], 'fewest_red_cards'],
    ['laliga', ['B', 'A'], 'fair_play'],
    ['ligue-1', ['B', 'A'], 'fair_play'],
  ])('S3 cartões — %s', (slug, expected, decidedBy) => {
    const t = computeTable({ rules: rules(slug), matches: [], ...S3 });
    expect(order(t)).toEqual(expected);
    expect(t[1]!.decidedBy).toBe(decidedBy);
  });

  describe('Brasileirão: empate triplo pula o confronto direto (max_teams: 2)', () => {
    // Vitórias, saldo e gols iguais. C tem um vermelho; B venceu A no confronto direto; A tem menos
    // amarelos que B. Com três empatados o confronto direto não vale, e não volta entre A e B
    // depois que os vermelhos separam C (REC, art. 15): os amarelos decidem.
    const base = {
      matches: [],
      baseline: [
        row('A', 15, 5, 18, 40, 35, { yellowCards: 50 }),
        row('B', 15, 5, 18, 40, 35, { yellowCards: 60 }),
        row('C', 15, 5, 18, 40, 35, { redCards: 1, yellowCards: 40 }),
      ],
      priorMatches: [match('B', 'A', 1, 0), match('A', 'B', 0, 0), match('C', 'A', 3, 0)],
    };
    it('os critérios seguem em sequência: amarelos entre os dois restantes', () => {
      const t = computeTable({ rules: rules('brasileirao-serie-a'), ...base });
      expect(order(t)).toEqual(['A', 'B', 'C']);
      expect(t.map((r) => r.decidedBy)).toEqual([null, 'fewest_yellow_cards', 'fewest_red_cards']);
    });
    it('com a reaplicação (padrão), o confronto direto voltaria entre A e B: o YAML a desliga', () => {
      const r = rules('brasileirao-serie-a');
      expect(r.standings.h2hReapply).toBe(false);
      const t = computeTable({ rules: { ...r, standings: { ...r.standings, h2hReapply: true } }, ...base });
      expect(order(t)).toEqual(['B', 'A', 'C']);
      expect(t[1]!.decidedBy).toBe('h2h_points');
    });
    it('persistindo o empate entre os dois, sorteio (sem voltar ao confronto direto)', () => {
      const t = computeTable({
        rules: rules('brasileirao-serie-a'),
        ...base,
        baseline: base.baseline.map((b) => (b.teamId === 'C' ? b : { ...b, yellowCards: 50 })),
      });
      expect(order(t)).toEqual(['A', 'B', 'C']);
      expect(t[1]!.decidedBy).toBe('drawing_of_lots');
      expect(t[0]!.unresolvedTieWith).toEqual(['B']);
    });
    it('dois empatados (C separado antes, pelas vitórias): o confronto direto vale entre eles', () => {
      const t = computeTable({
        rules: rules('brasileirao-serie-a'),
        ...base,
        baseline: [...base.baseline.slice(0, 2), row('C', 14, 8, 16, 40, 35)],
      });
      expect(order(t)).toEqual(['B', 'A', 'C']);
      expect(t.map((r) => r.decidedBy)).toEqual([null, 'h2h_points', 'wins']);
    });
  });

  describe('mini-liga de confronto direto com reaplicação (Serie A)', () => {
    const base = {
      matches: [],
      baseline: [row('A', 10, 0, 10, 30, 30), row('B', 10, 0, 10, 40, 30), row('C', 10, 0, 10, 32, 30)],
      priorMatches: [match('A', 'B', 5, 0), match('A', 'C', 1, 0), match('B', 'C', 1, 1)],
    };
    it('reaplica entre B e C (empatados entre si) → saldo geral decide', () => {
      const t = computeTable({ rules: rules('serie-a-italia'), ...base });
      expect(order(t)).toEqual(['A', 'B', 'C']);
      expect(t[2]!.decidedBy).toBe('goal_difference');
    });
    it('sem reaplicação, o saldo da mini-liga de três decide', () => {
      const r = rules('serie-a-italia');
      const t = computeTable({ rules: { ...r, standings: { ...r.standings, h2hReapply: false } }, ...base });
      expect(order(t)).toEqual(['A', 'C', 'B']);
      expect(t[2]!.decidedBy).toBe('h2h_goal_difference');
    });
  });

  it('Champions (fase de liga): pontos dos adversários enfrentados', () => {
    const t = computeTable({
      rules: rules('uefa-champions-league'),
      matches: [],
      baseline: [
        row('A', 1, 0, 1, 2, 2, { awayGoalsFor: 1, awayWon: 1 }),
        row('B', 1, 0, 1, 2, 2, { awayGoalsFor: 1, awayWon: 1 }),
        row('X', 3, 0, 0, 5, 1),
        row('Y', 2, 0, 1, 4, 2),
        row('Z', 1, 0, 2, 2, 4),
        row('W', 1, 0, 2, 2, 5),
      ],
      priorMatches: [
        match('A', 'X', 1, 1),
        match('Y', 'A', 0, 1),
        match('B', 'Z', 0, 1),
        match('W', 'B', 1, 1),
      ],
    });
    const a = t.find((r) => r.teamId === 'A')!;
    const b = t.find((r) => r.teamId === 'B')!;
    expect(a.rank).toBeLessThan(b.rank);
    expect(b.decidedBy).toBe('opponents_points');
  });
});

describe('ajustes de pontos, grupos e zonas', () => {
  const ms = [match('A', 'B', 3, 0), match('B', 'C', 1, 0), match('C', 'A', 0, 0)];

  it('punição derruba o time na tabela', () => {
    const base = computeTable({ rules: rules('default'), matches: ms });
    expect(order(base)).toEqual(['A', 'B', 'C']);
    const punished = computeTable({
      rules: rules('default'),
      matches: ms,
      adjustments: [{ teamId: 'A', points: -3 }],
    });
    // A (4 − 3 = 1 ponto) empata com C em pontos e fica à frente pelo saldo (+3 × −1).
    expect(order(punished)).toEqual(['B', 'A', 'C']);
    expect(punished[1]).toMatchObject({
      points: 1,
      pointsAdjustment: -3,
      won: 1,
      drawn: 1,
      decidedBy: 'points',
    });
    expect(punished[2]!.decidedBy).toBe('goal_difference');
  });

  it('calcula uma tabela por grupo, com zonas por posição dentro do grupo', () => {
    const rand = rng(7);
    const g1 = randomDoubleRoundRobin(['a1', 'a2', 'a3', 'a4'], rand, 'A');
    const g2 = randomDoubleRoundRobin(['b1', 'b2', 'b3', 'b4'], rand, 'B');
    const tables = computeStandings({ rules: rules('conmebol-libertadores'), matches: [...g2, ...g1] });
    expect(tables.map((t) => t.group)).toEqual(['A', 'B']);
    for (const t of tables) {
      expect(t.rows).toHaveLength(4);
      expect(t.rows.map((r) => r.played)).toEqual([6, 6, 6, 6]);
      expect(t.rows.map((r) => r.zone)).toEqual([
        'round_of_16',
        'round_of_16',
        'sudamericana_knockout_playoff',
        'elimination',
      ]);
      expect(new Set(t.rows.map((r) => r.group))).toEqual(new Set([t.group]));
    }
    expect(() => computeTable({ rules: rules('conmebol-libertadores'), matches: [...g1, ...g2] })).toThrow(
      StandingsInputError,
    );
  });

  it('times sem jogos aparecem zerados', () => {
    const t = computeTable({
      rules: rules('default'),
      matches: [match('A', 'B', 1, 0)],
      teams: [{ teamId: 'C' }],
    });
    expect(t.find((r) => r.teamId === 'C')).toMatchObject({ played: 0, points: 0, rank: 2 });
  });

  it('tabela vazia', () => {
    expect(computeStandings({ rules: rules('default'), matches: [] })).toEqual([]);
    expect(computeTable({ rules: rules('default'), matches: [] })).toEqual([]);
  });

  it('pontuação configurável (2 pontos por vitória)', () => {
    const r = rulesFrom({ standings: { points: { win: 2, draw: 1, loss: 0 } } });
    const t = computeTable({ rules: r, matches: [match('A', 'B', 1, 0), match('B', 'C', 0, 0)] });
    expect(t.map((x) => [x.teamId, x.points])).toEqual([
      ['A', 2],
      ['C', 1],
      ['B', 1],
    ]);
  });
});

describe('propriedades (ligas aleatórias)', () => {
  const SLUGS = [
    'brasileirao-serie-a',
    'premier-league',
    'laliga',
    'serie-a-italia',
    'bundesliga',
    'ligue-1',
    'default',
  ];

  function randomLeague(seed: number) {
    const rand = rng(seed);
    const n = 4 + randInt(rand, 16);
    const teams = Array.from({ length: n }, (_, i) => `t${String(i).padStart(2, '0')}`);
    const matches = randomDoubleRoundRobin(teams, rand).map((m) => ({
      ...m,
      cards: {
        home: { yellow: randInt(rand, 4), red: randInt(rand, 1) },
        away: { yellow: randInt(rand, 4) },
      },
    }));
    const adjustments =
      rand() < 0.3 ? [{ teamId: teams[randInt(rand, n - 1)]!, points: -3 * (1 + randInt(rand, 3)) }] : [];
    return { rand, teams, matches, adjustments };
  }

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))('invariantes da tabela — semente %i', (seed) => {
    const { teams, matches, adjustments } = randomLeague(seed);
    const slug = SLUGS[seed % SLUGS.length]!;
    const r = rules(slug);
    const t = computeTable({ rules: r, matches, adjustments });
    const adj = new Map(adjustments.map((a) => [a.teamId, a.points]));
    const totalGoals = matches.reduce((s, m) => s + m.homeGoals + m.awayGoals, 0);

    expect(t).toHaveLength(teams.length);
    expect(t.map((x) => x.rank)).toEqual(teams.map((_, i) => i + 1));
    for (const x of t) {
      expect(x.points).toBe(3 * x.won + x.drawn + (adj.get(x.teamId) ?? 0));
      expect(x.played).toBe(x.won + x.drawn + x.lost);
      expect(x.played).toBe(2 * (teams.length - 1));
      expect(x.goalDifference).toBe(x.goalsFor - x.goalsAgainst);
      expect(formString(x)).toMatch(/^[WDL]{1,5}$/);
    }
    expect(t.reduce((s, x) => s + x.goalsFor, 0)).toBe(totalGoals);
    expect(t.reduce((s, x) => s + x.goalsAgainst, 0)).toBe(totalGoals);
    expect(t.reduce((s, x) => s + x.won, 0)).toBe(t.reduce((s, x) => s + x.lost, 0));
    expect(t.reduce((s, x) => s + x.drawn, 0) % 2).toBe(0);
    expect(t.reduce((s, x) => s + x.played, 0)).toBe(2 * matches.length);
    expect(t.reduce((s, x) => s + x.yellowCards, 0)).toBe(
      matches.reduce((s, m) => s + (m.cards.home.yellow ?? 0) + (m.cards.away.yellow ?? 0), 0),
    );
    for (let i = 1; i < t.length; i++) {
      const [a, b] = [t[i - 1]!, t[i]!];
      expect(a.points).toBeGreaterThanOrEqual(b.points);
      if (a.points !== b.points) continue;
      // Critério imediatamente após os pontos, quando é geral (não depende dos empatados).
      if (slug === 'brasileirao-serie-a') expect(a.won).toBeGreaterThanOrEqual(b.won);
      if (['premier-league', 'bundesliga', 'ligue-1', 'default'].includes(slug)) {
        expect(a.goalDifference).toBeGreaterThanOrEqual(b.goalDifference);
      }
      if (
        ['premier-league', 'bundesliga', 'default'].includes(slug) &&
        a.goalDifference === b.goalDifference
      ) {
        expect(a.goalsFor).toBeGreaterThanOrEqual(b.goalsFor);
      }
    }
  });

  it.each(Array.from({ length: 20 }, (_, i) => i + 100))(
    'determinística: ordem de entrada não importa — semente %i',
    (seed) => {
      const { rand, matches } = randomLeague(seed);
      const r = rules(SLUGS[seed % SLUGS.length]!);
      const shuffled = [...matches].sort(() => rand() - 0.5);
      expect(computeTable({ rules: r, matches: shuffled })).toEqual(computeTable({ rules: r, matches }));
    },
  );

  it.each(Array.from({ length: 30 }, (_, i) => i + 200))(
    'incremental: tabela de partida + novos jogos = cálculo completo — semente %i',
    (seed) => {
      const { rand, matches, adjustments } = randomLeague(seed);
      const r = rules(SLUGS[seed % SLUGS.length]!);
      const cut = randInt(rand, matches.length);
      const before = matches.slice(0, cut);
      const after = matches.slice(cut);
      const partial = computeTable({
        rules: r,
        matches: before,
        adjustments,
        teams: matches.map((m) => ({ teamId: m.homeId })),
      });
      const baseline: BaselineRow[] = partial.map((x) => ({
        teamId: x.teamId,
        played: x.played,
        won: x.won,
        drawn: x.drawn,
        lost: x.lost,
        goalsFor: x.goalsFor,
        goalsAgainst: x.goalsAgainst,
        points: x.points,
        awayGoalsFor: x.awayGoalsFor,
        awayWon: x.awayWon,
        yellowCards: x.yellowCards,
        redCards: x.redCards,
        form: formString(x),
      }));
      const incremental = computeTable({ rules: r, matches: after, baseline, priorMatches: before });
      const full = computeTable({ rules: r, matches, adjustments });
      const strip = (rows: StandingRow[]) => rows.map((x) => ({ ...x, form: formString(x) }));
      expect(strip(incremental)).toEqual(strip(full));
    },
  );
});

describe('validação de entrada', () => {
  it('rejeita partida anterior inválida (priorMatches)', () => {
    const bad: MatchResult = match('A', 'A', 0, 0);
    expect(() => computeTable({ rules: rules('default'), matches: [], priorMatches: [bad] })).toThrow(
      /contra si mesmo/,
    );
  });
});
