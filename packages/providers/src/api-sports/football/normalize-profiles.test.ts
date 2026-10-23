import { describe, expect, it } from 'vitest';
import { loadFootballFixture } from '../../../test/load-fixture.js';
import {
  normalizeFootballEnvelope,
  normalizePlayers,
  normalizeSidelined,
  normalizeTransfers,
  normalizeTrophies,
} from './normalize.js';
import type { ApiPlayerItem, ApiTransferItem } from './types.js';

const FETCHED = new Date('2026-10-22T14:00:00Z');

describe('perfil completo do jogador', () => {
  it('players: local e país de nascimento e uma linha de estatística por time e temporada', () => {
    const items = loadFootballFixture<{ response: ApiPlayerItem[] }>('players-team-121-2024.json').response;
    items[0]!.statistics[0] = {
      ...items[0]!.statistics[0]!,
      games: {
        appearences: 30,
        lineups: 28,
        minutes: 2410,
        number: 9,
        position: 'Attacker',
        rating: '7.213',
        captain: false,
      },
      goals: { total: 14, conceded: 0, assists: 5, saves: null },
      cards: { yellow: 3, yellowred: 0, red: 1 },
      shots: { total: 61, on: 30 },
    };
    const b = normalizePlayers(items, FETCHED);
    expect(b.persons[0]).toMatchObject({ birthPlace: 'Cidade X', birthCountry: 'Brazil' });
    expect(b.personSeasonStats).toHaveLength(2);
    expect(b.personSeasonStats[0]).toEqual({
      personId: '900001',
      participantId: '121',
      season: { competitionId: '71', year: 2024 },
      position: 'Attacker',
      number: 9,
      captain: false,
      appearances: 30,
      lineups: 28,
      minutes: 2410,
      rating: 7.21,
      goals: 14,
      assists: 5,
      conceded: 0,
      saves: null,
      yellowCards: 3,
      redCards: 1,
      stats: {
        games: {
          appearences: 30,
          lineups: 28,
          minutes: 2410,
          number: 9,
          position: 'Attacker',
          rating: '7.213',
          captain: false,
        },
        goals: { total: 14, conceded: 0, assists: 5, saves: null },
        cards: { yellow: 3, yellowred: 0, red: 1 },
        shots: { total: 61, on: 30 },
      },
    });
    // sem os números, a linha existe com nulos (o jogador estava inscrito)
    expect(b.personSeasonStats[1]).toMatchObject({
      appearances: 8,
      minutes: null,
      rating: null,
      goals: null,
    });
  });

  it('transfers: cada mudança de time, sem repetir, com o nome de quem não está na base', () => {
    const team = (id: number, name: string) => ({
      id,
      name,
      logo: `https://media.api-sports.io/football/teams/${id}.png`,
    });
    const move = {
      date: '2025-01-01',
      type: 'Free',
      teams: { in: team(121, 'Palmeiras'), out: team(3942, 'Def. de Pronunciamiento') },
    };
    const items: ApiTransferItem[] = [
      {
        player: { id: 321438, name: 'M. Gutiérrez' },
        transfers: [move, move, { ...move, date: '2023-07-15', type: 'Loan' }],
      },
      { player: { id: null, name: null }, transfers: [move] },
    ];
    const b = normalizeTransfers(items, FETCHED);
    expect(b.transfers).toEqual([
      {
        personId: '321438',
        date: '2025-01-01',
        type: 'Free',
        fromParticipantId: '3942',
        toParticipantId: '121',
        fromName: 'Def. de Pronunciamiento',
        toName: 'Palmeiras',
      },
      expect.objectContaining({ date: '2023-07-15', type: 'Loan' }),
    ]);
    expect(b.persons.map((p) => [p.id, p.reference])).toEqual([['321438', true]]);
    expect(b.participants.map((p) => p.id).sort()).toEqual(['121', '3942']);
  });

  it('trophies e sidelined: aceitam players=a-b e player=a; técnicos ficam de fora', () => {
    const multi = [
      {
        id: 276,
        trophies: [
          { league: 'Copa do Brasil', country: 'Brazil', season: '2010', place: 'Winner' },
          { league: 'Copa do Brasil', country: 'Brazil', season: null, place: 'Winner' },
          { league: 'Copa do Brasil', country: 'Brazil', season: '2010', place: 'Winner' },
        ],
      },
      { id: 1947, trophies: [] },
    ];
    expect(normalizeTrophies(multi, FETCHED, { players: '276-1947' }).trophies).toEqual([
      { personId: '276', league: 'Copa do Brasil', country: 'Brazil', season: '2010', place: 'Winner' },
      { personId: '276', league: 'Copa do Brasil', country: 'Brazil', season: null, place: 'Winner' },
    ]);
    const single = [{ league: 'La Liga', country: 'Spain', season: '2015/2016', place: 'Winner' }];
    expect(normalizeTrophies(single, FETCHED, { player: '276' }).trophies).toEqual([
      { personId: '276', league: 'La Liga', country: 'Spain', season: '2015/2016', place: 'Winner' },
    ]);
    expect(normalizeTrophies(multi, FETCHED, { coachs: '276-1947' }).trophies).toEqual([]);

    const sidelined = [
      {
        id: 276,
        sidelined: [
          { type: 'Thigh Injury', start: '2025-09-19', end: null },
          { type: 'Thigh Injury', start: '2025-04-18', end: '2025-05-22' },
        ],
      },
    ];
    expect(normalizeSidelined(sidelined, FETCHED, { players: '276' }).sidelined).toEqual([
      { personId: '276', type: 'Thigh Injury', startDate: '2025-09-19', endDate: null },
      { personId: '276', type: 'Thigh Injury', startDate: '2025-04-18', endDate: '2025-05-22' },
    ]);
    expect(normalizeSidelined(sidelined, FETCHED, { coach: '276' }).sidelined).toEqual([]);
  });

  it('o despacho por endpoint cobre transfers, trophies e sidelined', () => {
    for (const endpoint of ['/transfers', '/trophies', '/sidelined']) {
      expect(normalizeFootballEnvelope(endpoint, { response: [] }, FETCHED)).toMatchObject({ items: 0 });
    }
  });
});
