import { beforeAll, describe, expect, it } from 'vitest';
import { loadCompetitionRules } from '../config/loader.js';
import type { CompetitionRules, LeagueRules } from '../config/types.js';
import { computeTable } from '../standings/compute.js';
import type { MatchResult } from '../standings/types.js';
import { doubleRoundRobinRounds, randInt, rng, rulesFrom } from '../test-helpers.js';
import type { Stake } from './codes.js';
import {
  analyzeLeague,
  LeagueInputError,
  leagueMatchStakes,
  type Fixture,
  type LeagueTeamInput,
} from './league.js';

let UCL: CompetitionRules;
let LIB: CompetitionRules;
let BRA: CompetitionRules;
beforeAll(async () => {
  UCL = await loadCompetitionRules('uefa-champions-league', { season: 2024 });
  LIB = await loadCompetitionRules('conmebol-libertadores', { season: 2024 });
  BRA = await loadCompetitionRules('brasileirao-serie-a', { season: 2024 });
});

/** Liga de 6 times, 10 jogos cada: 1º–2º vaga continental, 5º–6º rebaixados. */
const MINI: LeagueRules = rulesFrom({
  league: {
    teams: 6,
    matches_per_team: 10,
    zones: [
      { id: 'libertadores', kind: 'qualification', from: 1, to: 2 },
      { id: 'relegation', kind: 'relegation', from: 5, to: 6 },
    ],
  },
}).league!;

function table(rows: [string, number, number][]): LeagueTeamInput[] {
  return rows.map(([teamId, points, played]) => ({ teamId, points, played }));
}

const sideCodes = (stakes: Stake[], side: 'home' | 'away') =>
  stakes.filter((s) => s.team === side).map((s) => s.code);

describe('analyzeLeague', () => {
  it('pontos máximos e posições alcançáveis', () => {
    const out = analyzeLeague({
      table: table([
        ['A', 25, 9],
        ['B', 20, 9],
        ['C', 19, 9],
        ['D', 10, 9],
        ['E', 8, 9],
        ['F', 2, 9],
      ]),
      league: MINI,
    });
    const by = new Map(out.map((o) => [o.teamId, o]));
    expect(by.get('A')).toMatchObject({
      remaining: 1,
      maxPoints: 28,
      bestRank: 1,
      worstRank: 1,
      champion: true,
    });
    expect(by.get('B')).toMatchObject({ bestRank: 2, worstRank: 3, champion: false, titlePossible: false });
    expect(by.get('D')).toMatchObject({ bestRank: 4, worstRank: 5 });
    expect(by.get('F')).toMatchObject({ bestRank: 6, worstRank: 6 });
    expect(by.get('B')!.zones).toEqual([
      { zone: 'libertadores', kind: 'qualification', status: 'possible' },
      { zone: 'relegation', kind: 'relegation', status: 'impossible' },
    ]);
    expect(by.get('D')!.zones[1]!.status).toBe('possible');
    expect(by.get('F')!.zones[1]!.status).toBe('clinched');
  });

  it('times encerrados empatados em pontos seguem a ordem atual da tabela', () => {
    const out = analyzeLeague({
      table: table([
        ['A', 20, 10],
        ['B', 20, 10],
        ['C', 5, 10],
      ]),
      league: { ...MINI, zones: [] },
    });
    expect(out.map((o) => [o.bestRank, o.worstRank])).toEqual([
      [1, 1],
      [2, 2],
      [3, 3],
    ]);
  });

  it('usa o calendário restante quando informado', () => {
    const out = analyzeLeague({
      table: table([
        ['A', 10, 4],
        ['B', 9, 4],
      ]),
      league: { ...MINI, matchesPerTeam: null },
      remainingFixtures: [
        { homeId: 'A', awayId: 'B' },
        { homeId: 'B', awayId: 'A' },
      ],
    });
    expect(out.map((o) => o.maxPoints)).toEqual([16, 15]);
  });

  it.each([
    [
      'time repetido',
      {
        table: table([
          ['A', 1, 1],
          ['A', 1, 1],
        ]),
        league: MINI,
      },
      /repetido/,
    ],
    ['jogos demais', { table: table([['A', 1, 11]]), league: MINI }, /mais jogos/],
    [
      'sem jogos por time nem calendário',
      { table: table([['A', 1, 1]]), league: { ...MINI, matchesPerTeam: null } },
      /matches_per_team/,
    ],
    [
      'calendário com time desconhecido',
      { table: table([['A', 1, 1]]), league: MINI, remainingFixtures: [{ homeId: 'A', awayId: 'Z' }] },
      /fora da tabela/,
    ],
  ])('rejeita %s', (_n, input, msg) => {
    expect(() => analyzeLeague(input)).toThrow(LeagueInputError);
    expect(() => analyzeLeague(input)).toThrow(msg);
  });
});

describe('leagueMatchStakes — título', () => {
  type Case = [string, [string, number, number][], Fixture, Fixture[] | undefined, string[], string[]];
  const cases: Case[] = [
    [
      'já campeão matematicamente',
      [
        ['A', 28, 9],
        ['B', 20, 9],
        ['C', 15, 9],
        ['D', 10, 9],
        ['E', 8, 9],
        ['F', 2, 9],
      ],
      { homeId: 'A', awayId: 'F' },
      undefined,
      ['mathematically_champion', 'qualifies_for_libertadores'],
      ['mathematically_relegated'],
    ],
    [
      'líder 3 pontos à frente na última rodada: empate basta',
      [
        ['A', 24, 9],
        ['B', 21, 9],
        ['C', 15, 9],
        ['D', 12, 9],
        ['E', 8, 9],
        ['F', 2, 9],
      ],
      { homeId: 'A', awayId: 'D' },
      undefined,
      ['clinches_title_with_draw', 'qualifies_for_libertadores'],
      ['safe_from_relegation'],
    ],
    [
      'líder 2 pontos à frente na última rodada: só a vitória garante',
      [
        ['A', 23, 9],
        ['B', 21, 9],
        ['C', 15, 9],
        ['D', 12, 9],
        ['E', 8, 9],
        ['F', 2, 9],
      ],
      { homeId: 'A', awayId: 'D' },
      undefined,
      ['clinches_title_with_win', 'qualifies_for_libertadores'],
      ['safe_from_relegation'],
    ],
    [
      'confronto direto entre os dois primeiros: vitória do líder decide',
      [
        ['A', 21, 8],
        ['B', 19, 8],
        ['C', 12, 8],
        ['D', 10, 8],
        ['E', 8, 8],
        ['F', 2, 8],
      ],
      { homeId: 'A', awayId: 'B' },
      [
        { homeId: 'A', awayId: 'B' },
        { homeId: 'C', awayId: 'D' },
        { homeId: 'E', awayId: 'F' },
      ],
      ['clinches_title_with_win', 'qualifies_for_libertadores'],
      ['in_title_race', 'qualifies_for_libertadores'],
    ],
    [
      'líder depende de tropeço do vice em outro jogo',
      [
        ['A', 21, 8],
        ['B', 20, 8],
        ['C', 12, 8],
        ['D', 10, 8],
        ['E', 8, 8],
        ['F', 2, 8],
      ],
      { homeId: 'A', awayId: 'C' },
      [
        { homeId: 'A', awayId: 'C' },
        { homeId: 'B', awayId: 'D' },
        { homeId: 'E', awayId: 'F' },
      ],
      ['can_clinch_title', 'qualifies_for_libertadores'],
      // C (12, máx. 18) não alcança o top 2; vencendo (15), só A, B e D (máx. 16) podem ficar à frente.
      ['at_risk_of_relegation', 'secures_safety_with_win'],
    ],
  ];
  it.each(cases)('%s', (_n, rows, fixture, nextRound, home, away) => {
    const input = { table: table(rows), league: MINI, ...fixture, includePossibilities: true };
    const stakes = leagueMatchStakes(nextRound ? { ...input, nextRound } : input);
    expect(sideCodes(stakes, 'home')).toEqual(home);
    expect(sideCodes(stakes, 'away')).toEqual(away);
  });
});

describe('leagueMatchStakes — rebaixamento', () => {
  const rows: [string, number, number][] = [
    ['A', 25, 9],
    ['B', 20, 9],
    ['C', 14, 9],
    ['D', 11, 9],
    ['E', 9, 9],
    ['F', 2, 9],
  ];
  it('última rodada: D e E decidem quem cai no confronto direto', () => {
    const stakes = leagueMatchStakes({
      table: table(rows),
      league: MINI,
      homeId: 'D',
      awayId: 'E',
      nextRound: [
        { homeId: 'D', awayId: 'E' },
        { homeId: 'A', awayId: 'F' },
        { homeId: 'B', awayId: 'C' },
      ],
    });
    // D: 11; E: 9. D perde → E chega a 12 e passa D (cai). D empata → 12 contra 10 de E (salvo).
    // E só se salva vencendo.
    expect(sideCodes(stakes, 'home')).toEqual(['relegated_if_loses', 'secures_safety_with_draw']);
    expect(sideCodes(stakes, 'away')).toEqual(['relegated_unless_wins', 'secures_safety_with_win']);
  });

  it('sem a rodada informada, assume o pior caso para a certeza e o melhor para a possibilidade', () => {
    // E (9) empatando fica com 10 < 11 de D: cai. Vencendo (12), só se salva se D não vencer.
    const stakes = leagueMatchStakes({ table: table(rows), league: MINI, homeId: 'E', awayId: 'A' });
    expect(sideCodes(stakes, 'home')).toEqual(['relegated_unless_wins', 'can_secure_safety']);
    expect(sideCodes(stakes, 'away')).toEqual(['mathematically_champion', 'qualifies_for_libertadores']);
  });

  it('possibilidades só na reta final (ou se pedido)', () => {
    const early = table([
      ['A', 9, 3],
      ['B', 6, 3],
      ['C', 4, 3],
      ['D', 3, 3],
      ['E', 1, 3],
      ['F', 0, 3],
    ]);
    const quiet = leagueMatchStakes({ table: early, league: MINI, homeId: 'A', awayId: 'F' });
    expect(quiet).toEqual([]);
    const verbose = leagueMatchStakes({
      table: early,
      league: MINI,
      homeId: 'A',
      awayId: 'F',
      includePossibilities: true,
    });
    expect(sideCodes(verbose, 'home')).toEqual([
      'in_title_race',
      'can_qualify_for_libertadores',
      'at_risk_of_relegation',
    ]);
  });

  it.each([
    ['mandante igual ao visitante', { homeId: 'A', awayId: 'A' }, /diferentes/],
    [
      'time sem jogos restantes',
      {
        homeId: 'A',
        awayId: 'B',
        table: table([
          ['A', 1, 10],
          ['B', 1, 9],
        ]),
      },
      /não tem jogos/,
    ],
    [
      'time duas vezes na rodada',
      {
        homeId: 'A',
        awayId: 'B',
        nextRound: [
          { homeId: 'A', awayId: 'B' },
          { homeId: 'C', awayId: 'A' },
        ],
      },
      /duas vezes/,
    ],
  ])('rejeita %s', (_n, patch, msg) => {
    const input = { table: table(rows), league: MINI, ...patch };
    expect(() => leagueMatchStakes(input)).toThrow(msg);
  });
});

describe('Champions League — fase de liga (36 times, última rodada)', () => {
  const POINTS = [
    19, 18, 16, 16, 15, 15, 15, 14, 13, 13, 13, 12, 12, 12, 11, 11, 11, 10, 10, 10, 9, 9, 9, 8, 8, 8, 7, 7, 7,
    6, 6, 5, 4, 3, 1, 0,
  ];
  const teams = POINTS.map((p, i) => ({
    teamId: `t${String(i + 1).padStart(2, '0')}`,
    points: p,
    played: 7,
  }));
  const ids = teams.map((t) => t.teamId);
  // Última rodada: 1 × 36, 2 × 35, ...
  const nextRound = Array.from({ length: 18 }, (_, i) => ({ homeId: ids[i]!, awayId: ids[35 - i]! }));
  const stakesOf = (i: number) => {
    const f = nextRound.find((x) => x.homeId === ids[i] || x.awayId === ids[i])!;
    const side = f.homeId === ids[i] ? 'home' : 'away';
    return sideCodes(leagueMatchStakes({ table: teams, league: UCL.league!, ...f, nextRound }), side);
  };

  it('sem título em disputa; 19 pontos garantem o top 8', () => {
    expect(stakesOf(0)).toEqual(['qualifies_for_round_of_16']);
  });

  it('13 pontos (9º): garante o playoff e pode chegar ao top 8 com vitória e outros resultados', () => {
    expect(stakesOf(8)).toEqual(['qualifies_for_knockout_playoff', 'can_clinch_round_of_16']);
  });

  it('8 pontos (24º): briga pelo playoff, pode ser eliminado', () => {
    const codes = stakesOf(23);
    expect(codes).toContain('can_clinch_knockout_playoff');
    expect(codes).toContain('can_be_eliminated');
  });

  it('4 pontos ou menos: já eliminado (máx. 7 < 8 de 26 times)', () => {
    for (const i of [32, 33, 34, 35]) expect(stakesOf(i), ids[i]).toEqual(['mathematically_eliminated']);
  });

  it('5 pontos (32º): só sobrevive vencendo e ainda depende de outros (pode chegar ao 24º)', () => {
    expect(stakesOf(31)).toEqual(['can_qualify_for_knockout_playoff', 'eliminated_unless_wins']);
  });

  it('6 pontos (30º): vencendo, pode garantir o playoff com outros resultados', () => {
    expect(stakesOf(29)).toEqual(['can_clinch_knockout_playoff', 'eliminated_unless_wins']);
  });

  it('limites de posição são coerentes para os 36', () => {
    const out = analyzeLeague({ table: teams, league: UCL.league! });
    out.forEach((o, i) => {
      expect(o.bestRank).toBeLessThanOrEqual(i + 1);
      expect(o.worstRank).toBeGreaterThanOrEqual(i + 1);
      expect(o.champion).toBeNull();
    });
  });
});

describe('Libertadores — última rodada da fase de grupos', () => {
  const group = table([
    ['A', 13, 5],
    ['B', 7, 5],
    ['C', 4, 5],
    ['D', 3, 5],
  ]);
  const nextRound = [
    { homeId: 'A', awayId: 'D' },
    { homeId: 'B', awayId: 'C' },
  ];
  it('B empata e vai às oitavas; C precisa vencer para garantir o 3º lugar', () => {
    const stakes = leagueMatchStakes({
      table: group,
      league: LIB.league!,
      homeId: 'B',
      awayId: 'C',
      nextRound,
    });
    expect(sideCodes(stakes, 'home')).toEqual([
      'qualifies_for_sudamericana_knockout_playoff',
      'clinches_round_of_16_with_draw',
    ]);
    expect(sideCodes(stakes, 'away')).toEqual([
      'clinches_sudamericana_knockout_playoff_with_win',
      'can_qualify_for_round_of_16',
      'can_be_eliminated',
    ]);
  });

  it('A já classificado; D pode ir ao 3º lugar', () => {
    const stakes = leagueMatchStakes({
      table: group,
      league: LIB.league!,
      homeId: 'A',
      awayId: 'D',
      nextRound,
    });
    expect(sideCodes(stakes, 'home')).toEqual(['qualifies_for_round_of_16']);
    expect(sideCodes(stakes, 'away')).toEqual([
      'can_clinch_sudamericana_knockout_playoff',
      'eliminated_if_loses',
    ]);
  });
});

describe('propriedade: códigos de certeza se confirmam em todas as simulações do restante da temporada', () => {
  function play(rand: () => number, f: Fixture): MatchResult {
    return { ...f, homeGoals: randInt(rand, 3), awayGoals: randInt(rand, 3) };
  }
  function pointsOf(matches: readonly MatchResult[], teams: readonly string[]): Map<string, number> {
    const p = new Map(teams.map((t) => [t, 0]));
    for (const m of matches) {
      if (m.homeGoals > m.awayGoals) p.set(m.homeId, p.get(m.homeId)! + 3);
      else if (m.homeGoals < m.awayGoals) p.set(m.awayId, p.get(m.awayId)! + 3);
      else {
        p.set(m.homeId, p.get(m.homeId)! + 1);
        p.set(m.awayId, p.get(m.awayId)! + 1);
      }
    }
    return p;
  }

  it.each(Array.from({ length: 25 }, (_, i) => i + 1))('semente %i', (seed) => {
    const rand = rng(seed);
    const n = 6 + 2 * randInt(rand, 2);
    const teams = Array.from({ length: n }, (_, i) => `t${i}`);
    const rounds = doubleRoundRobinRounds(teams);
    const left = 1 + randInt(rand, 2);
    const played = rounds
      .slice(0, rounds.length - left)
      .flat()
      .map((f) => play(rand, f));
    const league: LeagueRules = {
      teams: n,
      matchesPerTeam: 2 * (n - 1),
      meetingsPerPair: 2,
      title: true,
      zones: [
        { id: 'libertadores', kind: 'qualification', from: 1, to: 2 },
        { id: 'sudamericana', kind: 'qualification', from: 3, to: 4 },
        { id: 'relegation', kind: 'relegation', from: n - 1, to: n },
      ],
    };
    const current = computeTable({ rules: { standings: BRA.standings, league }, matches: played });
    const nextRound = rounds[rounds.length - left]!;
    const rest = rounds.slice(rounds.length - left).flat();
    const outlook = new Map(analyzeLeague({ table: current, league }).map((o) => [o.teamId, o]));
    const claims: { team: string; fixture: Fixture; side: 'home' | 'away'; code: string }[] = [];
    for (const f of nextRound) {
      for (const s of leagueMatchStakes({
        table: current,
        league,
        ...f,
        nextRound,
        includePossibilities: true,
      })) {
        if (s.team !== 'both')
          claims.push({
            team: s.team === 'home' ? f.homeId : f.awayId,
            fixture: f,
            side: s.team,
            code: s.code,
          });
      }
    }
    for (let sim = 0; sim < 150; sim++) {
      const results = rest.map((f) => play(rand, f));
      const final = pointsOf([...played, ...results], teams);
      for (const t of teams) {
        const o = outlook.get(t)!;
        const above = teams.filter((u) => u !== t && final.get(u)! > final.get(t)!).length;
        const atLeast = teams.filter((u) => u !== t && final.get(u)! >= final.get(t)!).length;
        expect(above + 1).toBeGreaterThanOrEqual(o.bestRank);
        expect(atLeast + 1).toBeLessThanOrEqual(o.worstRank);
      }
      for (const c of claims) {
        const m = results[rest.indexOf(c.fixture)]!;
        const [mine, theirs] = c.side === 'home' ? [m.homeGoals, m.awayGoals] : [m.awayGoals, m.homeGoals];
        const res = mine > theirs ? 'W' : mine === theirs ? 'D' : 'L';
        const p = final.get(c.team)!;
        const strictlyAbove = teams.filter((u) => u !== c.team && final.get(u)! > p).length;
        const levelOrAbove = teams.filter((u) => u !== c.team && final.get(u)! >= p).length;
        const ctx = `${c.team} ${c.code} ${res} sim ${sim}`;
        const zoneTo = (code: string) => league.zones.find((z) => code.includes(z.id))!.to;
        if (c.code === 'mathematically_champion') expect(levelOrAbove, ctx).toBe(0);
        if (c.code === 'clinches_title_with_draw' && res !== 'L') expect(levelOrAbove, ctx).toBe(0);
        if (c.code === 'clinches_title_with_win' && res === 'W') expect(levelOrAbove, ctx).toBe(0);
        if (c.code.startsWith('qualifies_for_'))
          expect(levelOrAbove, ctx).toBeLessThanOrEqual(zoneTo(c.code) - 1);
        if (/^clinches_.+_with_win$/.test(c.code) && !c.code.includes('title') && res === 'W') {
          expect(levelOrAbove, ctx).toBeLessThanOrEqual(zoneTo(c.code) - 1);
        }
        if (/^clinches_.+_with_draw$/.test(c.code) && !c.code.includes('title') && res !== 'L') {
          expect(levelOrAbove, ctx).toBeLessThanOrEqual(zoneTo(c.code) - 1);
        }
        if (c.code === 'mathematically_relegated') expect(strictlyAbove, ctx).toBeGreaterThanOrEqual(n - 2);
        if (c.code === 'relegated_if_loses' && res === 'L')
          expect(strictlyAbove, ctx).toBeGreaterThanOrEqual(n - 2);
        if (c.code === 'relegated_unless_wins' && res !== 'W')
          expect(strictlyAbove, ctx).toBeGreaterThanOrEqual(n - 2);
        if (c.code === 'secures_safety_with_win' && res === 'W')
          expect(levelOrAbove, ctx).toBeLessThanOrEqual(n - 3);
        if (c.code === 'secures_safety_with_draw' && res !== 'L')
          expect(levelOrAbove, ctx).toBeLessThanOrEqual(n - 3);
        if (c.code === 'safe_from_relegation') expect(levelOrAbove, ctx).toBeLessThanOrEqual(n - 3);
      }
    }
  });
});
