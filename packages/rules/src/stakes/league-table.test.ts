import { describe, expect, it } from 'vitest';
import { loadCompetitionRules } from '../config/loader.js';
import { phaseResults, pickLeagueTable, roundWithin } from './league-table.js';

/** Linhas de `core.standing`: cada time com os jogos dados, em ordem. */
const rows = (group: string, teams: readonly string[], played: number) =>
  teams.map((participantId, i) => ({ group, participantId, rank: i + 1, played }));

const regular = (label: string) => ({ kind: 'regular', label });

describe('pickLeagueTable: a tabela da fase do jogo, não a de mais jogos', () => {
  it('Argentina: zona do Clausura, não a anual nem os promedios; matemática da zona', async () => {
    const ar = await loadCompetitionRules('argentina-liga-profesional', { season: 2026 });
    const all = [
      ...rows('Apertura - Group A', ['A', 'B'], 16),
      ...rows('Apertura - Group B', ['C', 'D'], 16),
      ...rows('Clausura - Group A', ['B', 'A'], 9),
      ...rows('Clausura - Group B', ['C', 'D'], 9),
      ...rows('Tabla Anual', ['C', 'A', 'B', 'D'], 25),
      ...rows('Promedios', ['D', 'C', 'B', 'A'], 78),
    ];
    const choice = pickLeagueTable(ar, regular('Clausura - 10'), all, 'A', 'B');
    expect(choice.reason).toBeUndefined();
    expect(choice.phase?.key).toBe('clausura');
    expect(choice.table?.map((r) => [r.group, r.participantId])).toEqual([
      ['Clausura - Group A', 'B'],
      ['Clausura - Group A', 'A'],
    ]);
    expect(choice.rules.league).toMatchObject({ teams: 15, matchesPerTeam: 16 });
    // interzonal: times em zonas diferentes
    expect(pickLeagueTable(ar, regular('Clausura - 10'), all, 'A', 'C').reason).toBe(
      'times em grupos diferentes',
    );
    // mata-mata rotulado como rodada: nenhuma fase
    expect(pickLeagueTable(ar, regular('Clausura - Round of 16'), all, 'A', 'B').reason).toBe(
      'rodada fora das fases do regulamento',
    );
  });

  it('Uruguai: Apertura, Intermedio (séries) e Clausura, cada um na sua tabela, nunca a anual', async () => {
    const uy = await loadCompetitionRules('uruguay-primera', { season: 2026 });
    const teams = ['P', 'N', 'D', 'W'];
    const all = [
      ...rows('Apertura', teams, 15),
      ...rows('Intermedio - Serie A', ['P', 'D'], 7),
      ...rows('Intermedio - Serie B', ['N', 'W'], 7),
      ...rows('Clausura', ['W', 'N', 'D', 'P'], 5),
      ...rows('Tabla Anual', teams, 27),
      ...rows('Promedios', teams, 90),
    ];
    const at = (label: string, home: string, away: string) => {
      const c = pickLeagueTable(uy, regular(label), all, home, away);
      return c.reason ?? `${c.phase?.key}:${c.table?.[0]?.group}`;
    };
    expect(at('Clausura - 6', 'P', 'N')).toBe('clausura:Clausura');
    expect(at('Apertura - 15', 'P', 'N')).toBe('apertura:Apertura');
    expect(at('Intermedio - 7', 'P', 'D')).toBe('intermedio:Intermedio - Serie A');
    expect(at('Intermedio - 7', 'P', 'N')).toBe('times em grupos diferentes');
  });

  it('Colômbia: Finalización, não a reclassificação; quadrangular não é pontos corridos do torneio', async () => {
    const co = await loadCompetitionRules('colombia-primera-a', { season: 2026 });
    const teams = ['M', 'N', 'S', 'T'];
    const all = [
      ...rows('Apertura', teams, 19),
      ...rows('Apertura - Group A', ['M', 'N'], 6),
      ...rows('Finalización', ['T', 'S', 'N', 'M'], 10),
      ...rows('Reclasificación', teams, 29),
    ];
    const c = pickLeagueTable(co, regular('Finalización - 11'), all, 'M', 'N');
    expect([c.phase?.key, c.table?.[0]?.group]).toEqual(['clausura', 'Finalización']);
    // quadrangular com rótulo de grupo: a fase não é inequívoca
    expect(pickLeagueTable(co, { kind: 'group', label: 'Group A - 2' }, all, 'M', 'N').reason).toBe(
      'rodada fora das fases do regulamento, sem fase inequívoca para os dois times',
    );
  });

  it('sem fases no regulamento: o grupo com os dois e mais jogos, como antes', async () => {
    const pl = await loadCompetitionRules('premier-league', { season: 2026 });
    const all = [...rows('Premier League', ['A', 'B'], 10), ...rows('Old label', ['A', 'B'], 9)];
    const c = pickLeagueTable(pl, regular('Regular Season - 11'), all, 'A', 'B');
    expect([c.phase, c.table?.[0]?.group]).toEqual([null, 'Premier League']);
  });
});

describe('roundWithin', () => {
  it('só os jogos entre times da tabela; com interzonal na rodada e cross_group, rodada desconhecida', () => {
    const round = [
      { homeId: 'A', awayId: 'B' },
      { homeId: 'C', awayId: 'X' },
    ];
    const ids = new Set(['A', 'B', 'C']);
    expect(roundWithin(round, ids, false)).toEqual([{ homeId: 'A', awayId: 'B' }]);
    expect(roundWithin(round, ids, true)).toBeUndefined();
  });
});

describe('phaseResults: os jogos que o recálculo soma na fase', () => {
  it('Libertadores: rodadas da fase e a rodada desconhecida adotada no grupo; mata-mata e outro tipo, fora', async () => {
    const lib = await loadCompetitionRules('conmebol-libertadores', { season: 2026 });
    const phase = lib.tables.find((t) => t.key === 'group_stage')!;
    const table = [...rows('Group A', ['A', 'B', 'C', 'D'], 2), ...rows('Group B', ['E', 'F', 'G', 'H'], 2)];
    const r = (id: string, homeId: string, awayId: string, roundLabel: string, stageKind = 'group') => ({
      id,
      homeId,
      awayId,
      roundLabel,
      stageKind,
    });
    const results = [
      r('known', 'A', 'B', 'Group Stage - 1'),
      r('adopted', 'A', 'C', 'Group Stage - 2 (remarcado)'),
      r('cross', 'A', 'E', 'Group Stage - 2 (remarcado)'),
      r('regular-kind', 'B', 'C', 'Rodada extra', 'regular'),
      r('knockout', 'A', 'B', 'Round of 16', 'round_of_16'),
    ];
    expect(phaseResults(lib, phase, results, table).map((m) => m.id)).toEqual(['known', 'adopted']);
    // sem fase: todos
    expect(phaseResults(lib, null, results, table)).toHaveLength(5);
  });

  it('Argentina: o Clausura não leva o Apertura, nem rodada desconhecida ambígua entre as fases', async () => {
    const ar = await loadCompetitionRules('argentina-liga-profesional', { season: 2026 });
    const clausura = ar.tables.find((t) => t.key === 'clausura')!;
    const table = [
      ...rows('Apertura - Group A', ['A', 'B'], 16),
      ...rows('Apertura - Group B', ['C', 'D'], 16),
      ...rows('Clausura - Group A', ['A', 'B'], 9),
      ...rows('Clausura - Group B', ['C', 'D'], 9),
    ];
    const results = [
      { id: 'ap', homeId: 'A', awayId: 'B', roundLabel: 'Apertura - 3', stageKind: 'regular' },
      { id: 'cl', homeId: 'A', awayId: 'B', roundLabel: 'Clausura - 3', stageKind: 'regular' },
      { id: 'unk', homeId: 'A', awayId: 'B', roundLabel: 'Fecha 3', stageKind: 'group' },
    ];
    expect(phaseResults(ar, clausura, results, table).map((m) => m.id)).toEqual(['cl']);
  });
});
