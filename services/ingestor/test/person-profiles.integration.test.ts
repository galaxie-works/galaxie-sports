import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  person,
  personSeasonStat,
  personSidelined,
  personTransfer,
  personTrophy,
  providerMap,
  sport,
  type Database,
} from '@galaxie/db';
import {
  normalizePlayers,
  normalizeSidelined,
  normalizeTransfers,
  normalizeTrophies,
  type ApiPlayerItem,
} from '@galaxie/providers';
import { upsertBatch } from '../src/normalize/upsert-core.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;

beforeAll(async () => {
  db = await testDb.setup();
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
}, 60_000);
afterAll(() => testDb.teardown());

const AT = new Date('2026-10-22T14:00:00Z');
const team = { id: 121, name: 'Palmeiras', logo: 'https://media.api-sports.io/football/teams/121.png' };

function profile(goals: number): ApiPlayerItem {
  return {
    player: {
      id: 900001,
      name: 'Atacante A',
      firstname: 'Atacante',
      lastname: 'A',
      age: 27,
      birth: { date: '1999-03-03', place: 'Cidade X', country: 'Brazil' },
      nationality: 'Brazil',
      height: '182 cm',
      weight: '78 kg',
      photo: null,
    },
    statistics: [
      {
        team,
        league: { id: 71, name: 'Serie A', country: 'Brazil', season: 2026 },
        games: {
          appearences: 30,
          lineups: 28,
          minutes: 2410,
          number: 9,
          position: 'Attacker',
          rating: '7.213',
        },
        goals: { total: goals, assists: 5, conceded: 0, saves: null },
        cards: { yellow: 3, yellowred: 0, red: 0 },
      },
    ],
  };
}

async function personByProvider(providerId: string): Promise<string> {
  const [m] = await db.select().from(providerMap).where(eq(providerMap.providerId, providerId));
  return m!.entityId;
}

describe('perfil completo do jogador no core', () => {
  it('bio, estatísticas da temporada (substituídas), transferências, títulos e afastamentos', async () => {
    const first = await upsertBatch(db, normalizePlayers([profile(14)], AT));
    expect(first.seasonStats).toBe(1);
    const id = await personByProvider('900001');
    const [p] = await db.select().from(person).where(eq(person.id, id));
    expect(p).toMatchObject({
      birthPlace: 'Cidade X',
      birthCountry: 'Brazil',
      birthDate: '1999-03-03',
      heightCm: 182,
    });

    await upsertBatch(db, normalizePlayers([profile(15)], AT));
    const stats = await db.select().from(personSeasonStat).where(eq(personSeasonStat.personId, id));
    expect(stats).toHaveLength(1);
    expect(stats[0]).toMatchObject({ appearances: 30, minutes: 2410, rating: '7.21', goals: 15, assists: 5 });
    expect(stats[0]!.stats).toMatchObject({ cards: { yellow: 3 } });

    const move = {
      date: '2025-01-01',
      type: 'Free',
      teams: { in: team, out: { ...team, id: 3942, name: 'Outro' } },
    };
    const transfers = normalizeTransfers(
      [{ player: { id: 900001, name: 'Atacante A' }, transfers: [move] }],
      AT,
    );
    await upsertBatch(db, transfers);
    await upsertBatch(db, transfers);
    const moves = await db.select().from(personTransfer).where(eq(personTransfer.personId, id));
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({
      date: '2025-01-01',
      type: 'Free',
      fromName: 'Outro',
      toName: 'Palmeiras',
    });
    expect(moves[0]!.fromParticipantId).not.toBeNull();

    // títulos e afastamentos: só de quem já está no core (555 não está)
    const trophies = [
      { id: 900001, trophies: [{ league: 'Serie A', country: 'Brazil', season: '2026', place: 'Winner' }] },
      { id: 555, trophies: [{ league: 'Serie A', country: 'Brazil', season: '2026', place: '2nd Place' }] },
    ];
    expect((await upsertBatch(db, normalizeTrophies(trophies, AT, { players: '900001-555' }))).trophies).toBe(
      1,
    );
    await upsertBatch(db, normalizeTrophies(trophies, AT, { players: '900001-555' }));
    expect(await db.select().from(personTrophy)).toHaveLength(1);

    const injury = (end: string | null) => [
      { id: 900001, sidelined: [{ type: 'Thigh Injury', start: '2026-09-19', end }] },
    ];
    await upsertBatch(db, normalizeSidelined(injury(null), AT, { players: '900001' }));
    await upsertBatch(db, normalizeSidelined(injury('2026-10-10'), AT, { players: '900001' }));
    const out = await db.select().from(personSidelined).where(eq(personSidelined.personId, id));
    expect(out).toEqual([
      expect.objectContaining({ type: 'Thigh Injury', startDate: '2026-09-19', endDate: '2026-10-10' }),
    ]);
  });
});
