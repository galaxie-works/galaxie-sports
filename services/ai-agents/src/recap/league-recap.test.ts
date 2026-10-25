import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  finishedLeagueMatchStakes,
  leagueInputOf,
  leagueMatchStakes,
  salienceStanding,
  type CompetitionRules,
  type LeagueTeamInput,
  type MatchResult,
  type TableSnapshotRow,
} from '@galaxie/rules';
import { loadCompetitionRules } from '@galaxie/rules/config';
import type { EventStakes } from '../context/stakes.js';
import {
  buildScenarioFacts,
  scenarioFactSheet,
  scenarioFallback,
  scenarioStakes,
} from '../context/scenario.js';
import { AGENT_LOCALES, checkGeneratedText, joinSentences, type AgentLocale } from '../guardrails/index.js';
import { sampleCore } from '../testing/samples.js';
import { buildRecapFacts, buildRecapFlow, type IncidentRow, type RecapGoal } from './facts.js';
import { recapFactSheet, recapFallback, recapSystemPrompt } from './recap.js';

/**
 * Brasileirão 2026, rodada 32, com a tabela e os jogos da produção (packages/rules/fixtures): o resumo de
 * Vasco 3 × 2 Corinthians (encerrado) e o cenário de Flamengo × Atlético-MG (pré-jogo).
 */
interface R32 {
  table: (TableSnapshotRow & { name: string })[];
  round32: {
    id: string;
    startsAt: string;
    status: string;
    homeId: string;
    awayId: string;
    homeGoals?: number;
    awayGoals?: number;
  }[];
}
const fx = JSON.parse(
  readFileSync(
    new URL('../../../../packages/rules/fixtures/brasileirao-serie-a-2026-r32.json', import.meta.url),
    'utf8',
  ),
) as R32;

let rules: CompetitionRules;
beforeAll(async () => {
  rules = await loadCompetitionRules('brasileirao-serie-a', { season: 2026 });
});

const sal = (t: LeagueTeamInput[], id: string) =>
  salienceStanding(t, rules.league!, id, rules.standings.points);

const team = (id: string, name: string) => ({
  id,
  side: 'home',
  name,
  shortName: null,
  aliases: [],
  labels: {},
});
const stage = {
  id: 'r32',
  kind: 'regular',
  name: { 'pt-BR': 'Rodada 32', es: 'Fecha 32' },
  providerLabel: 'Regular Season - 32',
};
const competition = { id: 'c', slug: 'brasileirao-serie-a', name: 'Serie A', tier: 1, labels: {} };

describe('Vasco 3 × 2 Corinthians (encerrado)', () => {
  const core = sampleCore({
    status: 'finished',
    statusDetail: 'FT',
    score: { home: 3, away: 2, halftime: { home: 1, away: 0 }, extratime: null, penalty: null },
    competition,
    stage,
    venue: { name: 'São Januário', city: 'Rio de Janeiro' },
    home: { ...team('vasco', 'Vasco da Gama'), side: 'home' },
    away: { ...team('corinthians', 'Corinthians'), side: 'away' },
  });
  const goal = (sequence: number, minute: number, participantId: string, person: string): IncidentRow => ({
    sequence,
    minute,
    extra: null,
    type: 'goal',
    detail: 'Normal Goal',
    participantId,
    person,
    assist: null,
  });
  const incidents: IncidentRow[] = [
    goal(1, 35, 'vasco', 'J. Rodríguez'),
    goal(3, 50, 'corinthians', 'Gustavo Henrique'),
    goal(4, 57, 'corinthians', 'Matheus Bidu'),
    goal(15, 88, 'vasco', 'M. Hinestroza'),
    goal(16, 90, 'vasco', 'M. Hinestroza'),
  ];

  function leagueInput(): Pick<EventStakes, 'stakes' | 'league' | 'result'> {
    const m = fx.round32.find((x) => x.id === 'vas-cor')!;
    const asResult = (x: R32['round32'][number]): MatchResult => ({
      id: x.id,
      homeId: x.homeId,
      awayId: x.awayId,
      homeGoals: x.homeGoals!,
      awayGoals: x.awayGoals!,
      playedAt: x.startsAt,
    });
    const f = finishedLeagueMatchStakes({
      rules,
      current: fx.table,
      match: asResult(m),
      later: fx.round32
        .filter((x) => x.status === 'finished' && x.id !== m.id && x.startsAt >= m.startsAt)
        .map(asResult),
    });
    const before = leagueInputOf(f.before);
    const after = leagueInputOf(f.after);
    const row = (t: LeagueTeamInput[], id: string) => {
      const i = t.findIndex((r) => r.teamId === id);
      return { teamId: id, rank: i + 1, points: t[i]!.points, played: t[i]!.played };
    };
    return {
      stakes: f.pre,
      league: {
        group: '',
        rows: [row(before, 'vasco'), row(before, 'corinthians')],
        teams: 20,
        remaining: { home: 8, away: 7 },
        standings: { home: null, away: null },
        salience: { home: sal(before, 'vasco'), away: sal(before, 'corinthians') },
      },
      result: {
        stakes: f.result,
        rows: [row(after, 'vasco'), row(after, 'corinthians')],
        salience: { home: sal(after, 'vasco'), away: sal(after, 'corinthians') },
      },
    };
  }

  it('virada com o gol da vitória aos 90 (sem acréscimo)', () => {
    const facts = buildRecapFacts(core, incidents, null, AGENT_LOCALES, null, leagueInput())!;
    expect(facts.flow).toEqual({
      winner: 'home',
      winner_max_deficit: 1,
      came_back_to_draw: null,
      decisive_goal: {
        team: 'home',
        minute: 90,
        extra: null,
        scorer: 'M. Hinestroza',
        late: true,
        stoppage_time: false,
      },
    });
  });

  it('fatos de tabela: antes e depois, só os códigos salientes', () => {
    const facts = buildRecapFacts(core, incidents, null, AGENT_LOCALES, null, leagueInput())!;
    expect(facts.league?.home).toEqual({
      rank_before: 15,
      rank_after: 13,
      points_before: 35,
      points_after: 38,
      remaining: 7,
    });
    expect(facts.league?.away).toMatchObject({ rank_before: 17, rank_after: 17, points_after: 33 });
    expect(facts.league?.before.map((s) => `${s.team}:${s.code}`)).toEqual([
      'home:at_risk_of_relegation',
      'away:at_risk_of_relegation',
    ]);
    expect(facts.league?.result.map((s) => `${s.team}:${s.code}`)).toEqual([
      'home:moved_up_to_13',
      'home:points_behind_sudamericana_1',
      'home:points_above_relegation_5',
      'away:points_below_safety_2',
      'away:stayed_at_17',
    ]);
  });

  it('texto determinístico em pt-BR e es-AR', () => {
    const facts = buildRecapFacts(core, incidents, null, AGENT_LOCALES, null, leagueInput())!;
    expect(recapFallback(core, facts, 'pt-BR')).toEqual([
      "Fim de jogo: Vasco da Gama 3 x 2 Corinthians, de virada, com o gol da vitória aos 90'",
      'Na tabela, Vasco da Gama subiu para o 13º lugar e fica a 1 ponto da vaga para a Sul-Americana; Corinthians fica a 2 pontos de sair da zona de rebaixamento e segue em 17º lugar',
      "Gols do Vasco da Gama: J. Rodríguez (35') e M. Hinestroza (88' e 90')",
      "Gols do Corinthians: Gustavo Henrique (50') e Matheus Bidu (57')",
    ]);
    expect(recapFallback(core, facts, 'es-AR')).toEqual([
      "Final del partido: Vasco da Gama 3-2 Corinthians, dándolo vuelta, con el gol del triunfo a los 90'",
      'En la tabla, Vasco da Gama subió al puesto 13 y queda a 1 punto de un lugar para la Sudamericana; Corinthians queda a 2 puntos de salir de la zona de descenso y sigue en el puesto 17',
      "Goles de Vasco da Gama: J. Rodríguez (35') y M. Hinestroza (88' y 90')",
      "Goles de Corinthians: Gustavo Henrique (50') y Matheus Bidu (57')",
    ]);
  });

  it.each(AGENT_LOCALES)('fallback passa no validador (%s)', (locale: AgentLocale) => {
    const facts = buildRecapFacts(core, incidents, null, AGENT_LOCALES, null, leagueInput())!;
    const text = joinSentences(recapFallback(core, facts, locale));
    expect(
      checkGeneratedText(text, { locale, facts: recapFactSheet(core, facts, locale), surface: 'mobile' }),
    ).toEqual([]);
  });

  it('validador aceita o texto do LLM com a tabela e barra posição inventada', () => {
    const facts = buildRecapFacts(core, incidents, null, AGENT_LOCALES, null, leagueInput())!;
    const sheet = recapFactSheet(core, facts, 'pt-BR');
    const ok =
      "O Vasco da Gama venceu o Corinthians por 3 a 2, de virada, com dois gols de M. Hinestroza aos 88' e aos 90'. " +
      'Com o resultado, o Vasco subiu do 15º para o 13º lugar, com 38 pontos, e fica 5 pontos acima da zona de rebaixamento.';
    expect(checkGeneratedText(ok, { locale: 'pt-BR', facts: sheet, surface: 'mobile' })).toEqual([]);
    const wrong = 'Com o resultado, o Vasco subiu para o 11º lugar.';
    expect(checkGeneratedText(wrong, { locale: 'pt-BR', facts: sheet }).map((v) => v.kind)).toContain(
      'unknown_number',
    );
  });

  it('prompt explica a tabela e o gol no fim sem chamar de acréscimo', () => {
    const prompt = recapSystemPrompt();
    expect(prompt).toContain('league.result');
    expect(prompt).toContain('stoppage_time');
  });
});

describe('buildRecapFlow', () => {
  const g = (
    team: 'home' | 'away',
    minute: number,
    extra: number | null,
    h: number,
    a: number,
  ): RecapGoal => ({
    minute,
    extra,
    team,
    scorer: `J${minute}`,
    assist: null,
    type: 'goal',
    score_after: { home: h, away: a },
  });

  it('gol nos acréscimos e empate buscado', () => {
    const flow = buildRecapFlow([g('home', 10, null, 1, 0), g('away', 90, 4, 1, 1)], { home: 1, away: 1 })!;
    expect(flow).toMatchObject({
      winner: null,
      came_back_to_draw: 'away',
      decisive_goal: { team: 'away', minute: 90, extra: 4, late: true, stoppage_time: true },
    });
  });

  it('vitória sem virada: o gol decisivo é o que pôs o time na frente de vez', () => {
    const flow = buildRecapFlow(
      [
        g('home', 5, null, 1, 0),
        g('away', 20, null, 1, 1),
        g('home', 60, null, 2, 1),
        g('home', 80, null, 3, 1),
      ],
      { home: 3, away: 1 },
    )!;
    expect(flow.winner_max_deficit).toBe(0);
    expect(flow.decisive_goal).toMatchObject({ minute: 60, late: false, stoppage_time: false });
  });

  it('sem placares parciais confiáveis, nada', () => {
    const { score_after: _, ...partial } = g('home', 5, null, 1, 0);
    expect(buildRecapFlow([partial], { home: 1, away: 0 })).toBeNull();
    expect(buildRecapFlow([], { home: 0, away: 0 })).toBeNull();
  });
});

describe('Flamengo × Atlético-MG (pré-jogo): cenário só com o saliente', () => {
  const core = sampleCore({
    competition,
    stage,
    venue: { name: 'Maracanã', city: 'Rio de Janeiro' },
    home: { ...team('flamengo', 'Flamengo'), side: 'home' },
    away: { ...team('atletico-mg', 'Atlético-MG'), side: 'away' },
  });

  function stakesOf(): EventStakes {
    const table: LeagueTeamInput[] = fx.table.map((t) => ({
      teamId: t.teamId,
      points: t.points,
      played: t.played,
    }));
    const row = (id: string) => {
      const i = table.findIndex((r) => r.teamId === id);
      return { teamId: id, rank: i + 1, points: table[i]!.points, played: table[i]!.played };
    };
    return {
      stakes: leagueMatchStakes({
        table,
        league: rules.league!,
        points: rules.standings.points,
        homeId: 'flamengo',
        awayId: 'atletico-mg',
        nextRound: [{ homeId: 'coritiba', awayId: 'gremio' }],
      }),
      rules,
      league: {
        group: '',
        rows: [row('flamengo'), row('atletico-mg')],
        teams: 20,
        remaining: { home: 7, away: 7 },
        standings: { home: null, away: null },
        salience: { home: sal(table, 'flamengo'), away: sal(table, 'atletico-mg') },
      },
    };
  }

  it('fatos: sem "risco de rebaixamento" e com a distância para o líder e para o G4', () => {
    const result = stakesOf();
    expect(result.stakes.map((s) => s.code)).toContain('at_risk_of_relegation');
    const facts = buildScenarioFacts(core, result, AGENT_LOCALES);
    expect(facts.stakes.map((s) => `${s.team}:${s.code}`)).toEqual([
      'home:clinches_libertadores_group_stage_with_win',
      'home:in_title_race',
      'away:can_qualify_for_libertadores_group_stage',
    ]);
    expect(facts.league?.home.distances).toEqual({ to_leader: 2 });
    expect(facts.league?.away.distances).toEqual({
      to_zone: [
        { zone: expect.objectContaining({ 'pt-BR': 'a fase de grupos da Libertadores' }), points: 4 },
      ],
    });
  });

  it('texto determinístico em pt-BR e es-AR', () => {
    const result = stakesOf();
    const facts = buildScenarioFacts(core, result, AGENT_LOCALES);
    const chosen = scenarioStakes(result);
    expect(scenarioFallback(core, facts, chosen, 'pt-BR')).toEqual([
      'Flamengo: vitória garante a fase de grupos da Libertadores; ainda briga pelo título',
      'Atlético-MG: ainda pode garantir a fase de grupos da Libertadores',
    ]);
    expect(scenarioFallback(core, facts, chosen, 'es-AR')).toEqual([
      'Flamengo: si gana, asegura la fase de grupos de la Libertadores; sigue en la pelea por el título',
      'Atlético-MG: todavía puede conseguir la fase de grupos de la Libertadores',
    ]);
  });

  it('validador aceita as distâncias citadas', () => {
    const result = stakesOf();
    const facts = buildScenarioFacts(core, result, AGENT_LOCALES);
    const sheet = scenarioFactSheet(core, facts, scenarioStakes(result), 'pt-BR');
    const text =
      'O Flamengo, a 2 pontos do líder, garante a fase de grupos da Libertadores se vencer. ' +
      'O Atlético-MG está a 4 pontos da fase de grupos da Libertadores.';
    expect(checkGeneratedText(text, { locale: 'pt-BR', facts: sheet, surface: 'tv' })).toEqual([]);
  });
});
