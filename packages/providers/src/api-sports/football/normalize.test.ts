import { describe, expect, it } from 'vitest';
import { loadFootballFixture } from '../../../test/load-fixture.js';
import {
  incidentType,
  normalizeCoaches,
  normalizeFootballEnvelope,
  normalizeFixtures,
  normalizeLeagues,
  normalizePlayers,
  normalizeSquads,
  normalizeStandings,
  normalizeTeams,
  parseMeasure,
} from './normalize.js';
import type { NormalizedEvent } from '../../model.js';
import type {
  ApiCoachItem,
  ApiFixture,
  ApiPlayerItem,
  ApiSquadItem,
  ApiStandingsItem,
  ApiTeamItem,
} from './types.js';

const FETCHED = new Date('2026-10-21T14:13:54Z');
const fixtures = (name: string) => loadFootballFixture<{ response: ApiFixture[] }>(name).response;

describe('normalizeFixtures — lista de uma temporada', () => {
  const batch = normalizeFixtures(fixtures('fixtures-league-71-2024.json'), FETCHED);

  it('gera eventos, competição, temporada, fase e participantes', () => {
    expect(batch).toMatchObject({ provider: 'api-sports', sport: 'football', observedAt: FETCHED });
    expect(batch.events).toHaveLength(4);
    expect(batch.competitions).toEqual([
      {
        id: '71',
        name: 'Serie A',
        type: 'league',
        countryName: 'Brazil',
        countryCode: null,
        logoUrl: 'https://media.api-sports.io/football/leagues/71.png',
        seasons: [{ year: 2024, label: null, startDate: null, endDate: null }],
      },
    ]);
    expect(batch.stages).toEqual([
      {
        season: { competitionId: '71', year: 2024 },
        providerLabel: 'Regular Season - 1',
        kind: 'regular',
        name: { 'pt-BR': 'Rodada 1', es: 'Fecha 1', en: 'Regular Season - 1' },
        order: 2001,
      },
    ]);
    expect(batch.participants).toHaveLength(8);
    expect(batch.participants.every((p) => p.kind === null)).toBe(true);
  });

  it('traduz estado, placar, relógio e horários', () => {
    const e = batch.events.find((x) => x.id === '1180355')!;
    expect(e.observation).toMatchObject({
      kind: 'valid',
      observedAt: FETCHED,
      status: 'finished',
      statusDetail: 'FT',
      clock: { minute: 90, extra: null, period: 'FT' },
      score: {
        home: 2,
        away: 1,
        halftime: { home: 0, away: 0 },
        extratime: null,
        penalty: null,
      },
    });
    expect(e.observation.startsAt.toISOString()).toBe('2024-04-13T21:30:00.000Z');
    expect(e.observation.endsAtExpected.toISOString()).toBe('2024-04-13T23:25:00.000Z');
    expect(e.participants).toEqual([
      { participantId: '119', side: 'home', position: null, result: { winner: true, goals: 2 } },
      { participantId: '118', side: 'away', position: null, result: { winner: false, goals: 1 } },
    ]);
    expect(e).toMatchObject({
      competitionId: '71',
      season: { competitionId: '71', year: 2024 },
      venueId: '244',
    });
    expect(e.incidents).toBeUndefined();
    expect(e.footballFixture).toMatchObject({
      providerFixtureId: 1180355,
      round: 'Regular Season - 1',
      detail: null,
    });
    expect(Object.keys(e.footballFixture!.summary)).toEqual(['fixture', 'league', 'teams', 'goals', 'score']);
  });

  it('jogo sem id de estádio não cria venue', () => {
    expect(batch.events.find((x) => x.id === '1180358')!.venueId).toBeNull();
    expect(batch.venues.map((v) => v.id).sort()).toEqual(['234', '244', '281']);
  });
});

describe('normalizeFixtures — agenda do dia (todos os status)', () => {
  const batch = normalizeFixtures(fixtures('fixtures-date-2026-10-21.json'), FETCHED);
  const byDetail: Record<string, NormalizedEvent> = Object.fromEntries(
    batch.events.map((e) => [e.observation.statusDetail ?? '', e]),
  );

  it('mapeia cada código', () => {
    expect(Object.fromEntries(Object.entries(byDetail).map(([k, e]) => [k, e.observation.status]))).toEqual({
      NS: 'scheduled',
      '1H': 'live',
      FT: 'finished',
      '2H': 'live',
      SUSP: 'suspended',
      PST: 'postponed',
      INT: 'suspended',
      CANC: 'cancelled',
      PEN: 'finished',
      AET: 'finished',
    });
  });

  it('prorrogação e pênaltis estendem o fim previsto e preenchem o placar', () => {
    const pen = byDetail.PEN!;
    expect(pen.observation.score).toMatchObject({
      extratime: { home: 0, away: 0 },
      penalty: { home: 4, away: 5 },
    });
    expect(pen.observation.endsAtExpected.getTime() - pen.observation.startsAt.getTime()).toBe(160 * 60_000);
  });

  it('estádio com id 0 ou nulo é ignorado', () => {
    expect(byDetail['2H']!.venueId).toBeNull();
    expect(byDetail['1H']!.venueId).toBeNull();
  });
});

describe('normalizeFixtures — detalhe (fixtures?id)', () => {
  const batch = normalizeFixtures(fixtures('fixtures-id-1492407.json'), FETCHED);
  const e = batch.events[0]!;

  it('timeline com sequência estável e tipos canônicos', () => {
    expect(e.incidents!.map((i) => [i.sequence, i.minute, i.extra, i.type, i.detail])).toEqual([
      [0, 12, null, 'goal', 'Normal Goal'],
      [1, 30, null, 'card', 'Yellow Card'],
      [2, 45, 2, 'own_goal', 'Own Goal'],
      [3, 58, null, 'penalty_missed', 'Missed Penalty'],
      [4, 63, null, 'subst', 'Substitution 1'],
      [5, 70, null, 'var', 'Goal cancelled'],
      [6, 77, null, 'goal', 'Penalty'],
      [7, 81, null, 'goal', 'Normal Goal'],
      [8, 90, 4, 'goal', 'Normal Goal'],
    ]);
    expect(e.incidents![0]).toMatchObject({
      participantId: '121',
      personId: '900001',
      assistPersonId: '900002',
    });
    expect(e.incidents![1]).toMatchObject({ participantId: '131', personId: '900011', assistPersonId: null });
  });

  it('detalhe guarda escalações, estatísticas e jogadores; pessoas vêm de todas as partes', () => {
    expect(Object.keys(e.footballFixture!.detail!)).toEqual(['events', 'lineups', 'statistics', 'players']);
    expect(batch.persons.map((p) => p.id).sort()).toEqual(
      ['800001', '800002', '900001', '900002', '900003', '900011', '900012', '900013'].sort(),
    );
    expect(batch.persons.find((p) => p.id === '800001')).toMatchObject({
      name: 'Técnico A',
      photoKind: 'coach',
    });
    expect(batch.persons.find((p) => p.id === '900001')).toMatchObject({
      photoUrl: 'https://media.api-sports.io/football/players/900001.png',
    });
  });

  it('usa o início real para o fim previsto', () => {
    expect(e.observation.endsAtExpected.toISOString()).toBe('2026-10-11T22:25:00.000Z');
  });
});

describe('outros endpoints', () => {
  it('teams?country: clubes, seleção e estádio com país', () => {
    const b = normalizeTeams(
      loadFootballFixture<{ response: ApiTeamItem[] }>('teams-country-brazil.json').response,
      FETCHED,
    );
    expect(b.participants.find((p) => p.id === '6')).toMatchObject({
      kind: 'national_team',
      code: 'BRA',
      countryName: 'Brazil',
      founded: 1914,
      venueId: '11531',
    });
    expect(b.participants.find((p) => p.id === '121')).toMatchObject({ kind: 'club', name: 'Palmeiras' });
    // Dado real: o fornecedor repete o id 11531 para dois estádios; a última ocorrência prevalece.
    expect(b.venues).toHaveLength(2);
    expect(b.venues.find((v) => v.id === '11531')).toMatchObject({
      name: 'Estádio 11531',
      city: 'São Paulo, São Paulo',
      countryName: 'Brazil',
      capacity: 49205,
      surface: 'grass',
    });
  });

  it('players/squads: elenco atual com fotografia para substituir', () => {
    const b = normalizeSquads(
      loadFootballFixture<{ response: ApiSquadItem[] }>('players-squads-121.json').response,
      FETCHED,
    );
    expect(b.rosterSnapshots).toEqual([{ participantId: '121', role: 'player' }]);
    expect(b.rosters).toHaveLength(4);
    expect(b.rosters[0]).toMatchObject({
      participantId: '121',
      season: null,
      role: 'player',
      number: 21,
      position: 'Goalkeeper',
    });
    expect(b.persons[0]).toMatchObject({ name: 'Jogador 1', photoKind: 'player' });
  });

  it('coachs?team: só o técnico atual do time pedido entra no elenco', () => {
    const b = normalizeCoaches(
      loadFootballFixture<{ response: ApiCoachItem[] }>('coachs-121.json').response,
      FETCHED,
      { team: '121' },
    );
    expect(b.persons).toHaveLength(2);
    expect(b.persons[0]).toMatchObject({
      birthDate: '1974-01-01',
      heightCm: 178,
      weightKg: 75,
      photoKind: 'coach',
    });
    expect(b.rosters).toEqual([
      {
        participantId: '121',
        personId: '800001',
        season: null,
        role: 'coach',
        number: null,
        position: null,
        validFrom: '2020-11-01',
        validTo: null,
      },
    ]);
    expect(b.rosterSnapshots).toEqual([{ participantId: '121', role: 'coach' }]);
  });

  it('players: perfil completo e elenco por temporada de cada competição', () => {
    const b = normalizePlayers(
      loadFootballFixture<{ response: ApiPlayerItem[] }>('players-team-121-2024.json').response,
      FETCHED,
    );
    expect(b.persons[0]).toMatchObject({ firstName: 'Atacante', heightCm: 182, nationality: 'Brazil' });
    expect(b.rosters.map((r) => [r.season?.competitionId, r.season?.year, r.number, r.position])).toEqual([
      ['71', 2024, 9, 'Attacker'],
      ['13', 2024, 9, 'Attacker'],
    ]);
  });

  it('standings: uma linha por time e grupo, fonte do provedor', () => {
    const b = normalizeStandings(
      loadFootballFixture<{ response: ApiStandingsItem[] }>('standings-71-2024.json').response,
      FETCHED,
    );
    expect(b.standings).toHaveLength(3);
    expect(b.standings[0]).toEqual({
      season: { competitionId: '71', year: 2024 },
      group: 'Serie A',
      participantId: '121',
      rank: 1,
      points: 73,
      played: 38,
      won: 22,
      drawn: 7,
      lost: 9,
      goalsFor: 60,
      goalsAgainst: 27,
      form: 'WWDWL',
      description: 'Promotion - CONMEBOL Libertadores (Group Stage: )',
    });
    expect(b.competitions[0]?.seasons).toEqual([{ year: 2024, label: null, startDate: null, endDate: null }]);
  });

  it('leagues: competições com tipo e temporadas', () => {
    const b = normalizeLeagues(
      [
        {
          league: { id: 73, name: 'Copa Do Brasil', type: 'Cup', logo: null },
          country: { name: 'Brazil', code: 'br', flag: null },
          seasons: [{ year: 2024, start: '2024-02-21', end: '2024-11-10' }],
        },
      ],
      FETCHED,
    );
    expect(b.competitions[0]).toMatchObject({ id: '73', type: 'cup', countryCode: 'BR' });
    expect(b.competitions[0]?.seasons[0]).toMatchObject({ startDate: '2024-02-21', endDate: '2024-11-10' });
  });
});

describe('despacho por endpoint', () => {
  it('h2h usa o mesmo normalizador de partidas', () => {
    const env = loadFootballFixture('fixtures-headtohead-121-131.json');
    const r = normalizeFootballEnvelope('/fixtures/headtohead', env, FETCHED)!;
    expect(r.items).toBe(3);
    expect(r.batch.events).toHaveLength(3);
    expect(new Set(r.batch.competitions.map((c) => c.id))).toEqual(new Set(['71', '475']));
  });

  it('endpoints sem normalização devolvem null; envelope vazio devolve 0 itens', () => {
    expect(normalizeFootballEnvelope('/odds', { response: [] }, FETCHED)).toBeNull();
    expect(normalizeFootballEnvelope('/fixtures', { response: [] }, FETCHED)).toMatchObject({ items: 0 });
  });

  it('é determinístico (mesma entrada, mesmo lote)', () => {
    const env = loadFootballFixture('fixtures-date-2026-10-21.json');
    expect(normalizeFootballEnvelope('/fixtures', env, FETCHED)).toEqual(
      normalizeFootballEnvelope('/fixtures', env, FETCHED),
    );
  });
});

describe('utilidades', () => {
  it('parseMeasure', () => {
    expect(parseMeasure('180 cm')).toBe(180);
    expect(parseMeasure(null)).toBeNull();
    expect(parseMeasure('n/d')).toBeNull();
  });

  it('incidentType', () => {
    expect(incidentType({ type: 'Goal', detail: 'Normal Goal' })).toBe('goal');
    expect(incidentType({ type: 'Card', detail: 'Red Card' })).toBe('card');
    expect(incidentType({ type: '', detail: null })).toBe('other');
  });
});
