import { describe, expect, it } from 'vitest';
import type { MatchResult } from '@galaxie/rules';
import { ANNUAL_GROUP, FIRST_PHASE_GROUP, phaseOfRound, planPhases } from './phases-auto.js';

let day = 0;
function game(
  home: string,
  away: string,
  roundLabel: string | null,
): MatchResult & { roundLabel: string | null } {
  day++;
  return {
    id: `e${day}`,
    homeId: home,
    awayId: away,
    homeGoals: 1,
    awayGoals: 0,
    playedAt: new Date(Date.UTC(2026, 0, day)).toISOString(),
    roundLabel,
  };
}

/** Todos contra todos (ida) entre `teams`, na fase `phase`. */
function roundRobin(teams: readonly string[], phase: string) {
  const out = [];
  let round = 1;
  for (let i = 0; i < teams.length; i++)
    for (let j = i + 1; j < teams.length; j++) out.push(game(teams[i]!, teams[j]!, `${phase} - ${round++}`));
  return out;
}

const groupsOf = (entries: Record<string, string[]>) => {
  const map = new Map<string, Set<string>>();
  for (const [group, teams] of Object.entries(entries))
    for (const t of teams) map.set(t, (map.get(t) ?? new Set()).add(group));
  return map;
};

const tablesOf = (plan: ReturnType<typeof planPhases>) => {
  if (plan.kind !== 'multi') throw new Error(plan.kind);
  return plan.sets.flatMap(({ matches, groupOf }) => {
    // numa fase com grupos, o grupo do jogo é o dos dois times (o interzonal não entra na contagem)
    const set = groupOf
      ? matches
          .filter((m) => groupOf.get(m.homeId) === groupOf.get(m.awayId))
          .map((m) => ({ ...m, group: groupOf.get(m.homeId)! }))
      : matches;
    return [...new Set(set.map((m) => m.group))].map((group) => {
      const games = set.filter((m) => m.group === group);
      return {
        group,
        teams: [...new Set(games.flatMap((m) => [m.homeId, m.awayId]))].sort(),
        games: games.length,
      };
    });
  });
};

describe('phaseOfRound', () => {
  it('tira o número da rodada; rodada sem número é mata-mata', () => {
    expect(phaseOfRound('Apertura - 7')).toBe('Apertura');
    expect(phaseOfRound('Apertura - Quadrangular - 3')).toBe('Apertura - Quadrangular');
    expect(phaseOfRound('Apertura - Final')).toBeNull();
    expect(phaseOfRound('Round of 16')).toBeNull();
    expect(phaseOfRound(null)).toBeNull();
  });
});

describe('planPhases', () => {
  const teams = ['A', 'B', 'C', 'D'];

  it('uma fase só segue o caminho de sempre', () => {
    expect(planPhases(roundRobin(teams, 'Regular Season'), new Map()).kind).toBe('single');
    expect(planPhases([game('A', 'B', null)], new Map()).kind).toBe('single');
  });

  it('Apertura e Clausura: uma tabela por torneio e a anual com os dois', () => {
    const results = [
      ...roundRobin(teams, 'Apertura'),
      ...roundRobin(teams, 'Clausura'),
      game('A', 'B', 'Clausura - Final'),
    ];
    expect(tablesOf(planPhases(results, new Map()))).toEqual([
      { group: 'Apertura', teams, games: 6 },
      { group: 'Clausura', teams, games: 6 },
      { group: ANNUAL_GROUP, teams, games: 12 },
    ]);
  });

  it('interzonal conta na tabela da zona de cada time', () => {
    const results = [
      game('A', 'B', 'Apertura - 1'),
      game('C', 'D', 'Apertura - 1'),
      game('A', 'C', 'Apertura - 2'), // interzonal
      ...roundRobin(teams, 'Clausura'),
    ];
    const plan = planPhases(
      results,
      groupsOf({ 'Apertura - Group A': ['A', 'B'], 'Apertura - Group B': ['C', 'D'] }),
    );
    if (plan.kind !== 'multi') throw new Error(plan.kind);
    const apertura = plan.sets[0]!;
    expect(apertura.matches).toHaveLength(3);
    expect(apertura.groupOf?.get('A')).toBe('Apertura - Group A');
    expect(apertura.groupOf?.get('C')).toBe('Apertura - Group B');
  });

  it('grupos do fornecedor por torneio: cada um com os jogos do seu torneio', () => {
    const results = [
      ...roundRobin(['A', 'B'], 'Apertura'),
      ...roundRobin(['C', 'D'], 'Apertura'),
      ...roundRobin(['A', 'C'], 'Clausura'),
      ...roundRobin(['B', 'D'], 'Clausura'),
    ];
    const groups = groupsOf({
      'Apertura - Group A': ['A', 'B'],
      'Apertura - Group B': ['C', 'D'],
      'Clausura - Group A': ['A', 'C'],
      'Clausura - Group B': ['B', 'D'],
    });
    const tables = tablesOf(planPhases(results, groups));
    expect(tables.map((t) => [t.group, t.teams.join(''), t.games])).toEqual([
      ['Apertura - Group A', 'AB', 1],
      ['Apertura - Group B', 'CD', 1],
      ['Clausura - Group A', 'AC', 1],
      ['Clausura - Group B', 'BD', 1],
      [ANNUAL_GROUP, 'ABCD', 4],
    ]);
  });

  it('1ª fase com todos e 2ª fase em grupos: "1ª fase" completa, sem tabela anual', () => {
    const results = [...roundRobin(teams, 'Regular Season'), ...roundRobin(['A', 'B'], 'Second Stage')];
    const groups = groupsOf({ 'Second stage - Group A': ['A', 'B'] });
    expect(tablesOf(planPhases(results, groups))).toEqual([
      { group: FIRST_PHASE_GROUP, teams, games: 6 },
      { group: 'Second stage - Group A', teams: ['A', 'B'], games: 1 },
    ]);
  });

  it('quadrangular com parte dos times não entra na anual', () => {
    const results = [
      ...roundRobin(teams, 'Apertura'),
      ...roundRobin(['A', 'B'], 'Apertura - Quadrangular'),
      ...roundRobin(teams, 'Clausura'),
    ];
    const groups = groupsOf({ 'Primera Division: Apertura - Quadrangular': ['A', 'B'] });
    const tables = tablesOf(planPhases(results, groups));
    expect(tables.map((t) => [t.group, t.games])).toEqual([
      ['Apertura', 6],
      ['Primera Division: Apertura - Quadrangular', 1],
      ['Clausura', 6],
      [ANNUAL_GROUP, 12],
    ]);
  });

  it('a tabela anual do fornecedor é usada no lugar da nossa', () => {
    const results = [...roundRobin(teams, 'Apertura'), ...roundRobin(teams, 'Clausura')];
    const groups = groupsOf({ 'Primera B: Tabla Anual': teams });
    expect(tablesOf(planPhases(results, groups)).map((t) => t.group)).toEqual([
      'Apertura',
      'Clausura',
      'Primera B: Tabla Anual',
    ]);
  });

  it('zonas paralelas (Norte e Sul) ficam separadas e não somam numa anual', () => {
    const results = [...roundRobin(['A', 'B'], 'North'), ...roundRobin(['C', 'D'], 'South')];
    expect(tablesOf(planPhases(results, new Map())).map((t) => [t.group, t.teams.join('')])).toEqual([
      ['North', 'AB'],
      ['South', 'CD'],
    ]);
  });

  it('grupo do fornecedor sem o nome da fase vai para a fase em que os times jogam só entre si', () => {
    const results = [
      ...roundRobin(teams, 'Apertura'),
      ...roundRobin(['A', 'B'], 'Torneo de Verano'),
      ...roundRobin(['A', 'B'], 'Torneo de Verano'),
    ];
    const tables = tablesOf(planPhases(results, groupsOf({ 'GROUP A': ['A', 'B'] })));
    expect(tables.find((t) => t.group === 'GROUP A')).toEqual({
      group: 'GROUP A',
      teams: ['A', 'B'],
      games: 2,
    });
  });

  it('grupo que ainda não fechou em nenhuma fase (rebaixamento antes de começar) não quebra a fase regular', () => {
    const results = [...roundRobin(teams, 'Regular Season'), ...roundRobin(teams, 'Championship Group')];
    const tables = tablesOf(planPhases(results, groupsOf({ 'Liga Pro: Relegation Group': ['C', 'D'] })));
    expect(tables.map((t) => [t.group, t.teams.join('')])).toEqual([
      [FIRST_PHASE_GROUP, 'ABCD'],
      ['Championship Group', 'ABCD'],
      [ANNUAL_GROUP, 'ABCD'],
    ]);
  });

  it('rodada sem número: com o nome da fase entra nela; de estágio de grupos é fase própria; regular sem fase, fora', () => {
    const results = [
      ...roundRobin(teams, 'Regular Season'),
      { ...game('A', 'B', 'Regular Season'), stageKind: 'regular' },
      ...roundRobin(['A', 'B'], 'Second Stage'),
      { ...game('C', 'D', 'Group Stage'), stageKind: 'group' },
      { ...game('A', 'C', 'Final'), stageKind: 'regular' },
    ];
    expect(tablesOf(planPhases(results, new Map())).map((t) => [t.group, t.games])).toEqual([
      [FIRST_PHASE_GROUP, 7],
      ['Second Stage', 1],
      ['Group Stage', 1],
    ]);
  });

  it('time em dois grupos da mesma fase: erro, nada é gravado', () => {
    const results = [...roundRobin(teams, 'Apertura'), ...roundRobin(teams, 'Clausura')];
    const plan = planPhases(
      results,
      groupsOf({ 'Apertura - Group A': ['A', 'B'], 'Apertura - Group B': ['B', 'C'] }),
    );
    expect(plan).toMatchObject({ kind: 'error', detail: expect.stringContaining('Apertura') });
  });
});
