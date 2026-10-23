import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  event,
  footballFixture,
  participant,
  person,
  providerMap,
  roster,
  sport,
  type Database,
} from '@galaxie/db';
import { normalizeCoaches, type ApiCoachItem } from '@galaxie/providers';
import { splitCoachIds } from '../src/normalize/split-coaches.js';
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

const map = (providerId: string, entityId: string, entityType = 'person') =>
  db
    .insert(providerMap)
    .values({ entityType, entityId, provider: 'api-sports', sport: 'football', providerId });

async function personWith(providerId: string, name: string, photoUrl?: string): Promise<string> {
  const photo = photoUrl
    ? (await db.insert(asset).values({ kind: 'coach', sourceUrl: photoUrl }).returning())[0]!.id
    : null;
  const [p] = await db.insert(person).values({ name, photoAssetId: photo }).returning();
  await map(providerId, p!.id);
  return p!.id;
}

async function lineupGame(
  seq: number,
  coach: { id: number; name: string },
  players: { id: number; name: string }[],
) {
  const startsAt = new Date('2026-09-01T20:00:00Z');
  const [e] = await db
    .insert(event)
    .values({ sport: 'football', startsAt, endsAtExpected: new Date(startsAt.getTime() + 7_200_000) })
    .returning();
  await db.insert(footballFixture).values({
    eventId: e!.id,
    providerFixtureId: 800_000 + seq,
    summary: {},
    detail: {
      lineups: [
        { team: { id: 121 }, coach, startXI: players.map((player) => ({ player })), substitutes: [] },
      ],
    },
  });
}

const providerIdOf = async (entityId: string) =>
  (await db.select().from(providerMap).where(eq(providerMap.entityId, entityId))).map((m) => m.providerId);
const entityOf = async (providerId: string) =>
  (
    await db
      .select()
      .from(providerMap)
      .where(and(eq(providerMap.entityType, 'person'), eq(providerMap.providerId, providerId)))
  ).map((m) => m.entityId);

describe('separar técnicos e jogadores com o mesmo id da api-sports', () => {
  it('só técnico muda de mapeamento; técnico e jogador viram duas pessoas; a segunda execução não faz nada', async () => {
    const [team] = await db
      .insert(participant)
      .values({ sport: 'football', kind: 'club', name: 'Palmeiras' })
      .returning();
    await map('121', team!.id, 'participant');
    const pure = await personWith(
      '500',
      'Técnico Puro',
      'https://media.api-sports.io/football/coachs/500.png',
    );
    const mixed = await personWith(
      '600',
      'Nome Misturado',
      'https://media.api-sports.io/football/coachs/600.png',
    );
    const onlyPlayer = await personWith('700', 'Jogador Só');
    await db.insert(roster).values([
      { participantId: team!.id, personId: pure, role: 'coach' },
      { participantId: team!.id, personId: mixed, role: 'coach' },
    ]);
    await lineupGame(1, { id: 500, name: 'Técnico Puro' }, [{ id: 700, name: 'Jogador Só' }]);
    await lineupGame(2, { id: 600, name: 'Técnico X' }, [{ id: 600, name: 'Jogador X' }]);

    // prévia: mesmas contagens, nada gravado
    expect(await splitCoachIds(db, { dryRun: true })).toEqual({
      coachIds: 2,
      renamed: 1,
      split: 1,
      rostersMoved: 1,
    });
    expect(await providerIdOf(pure)).toEqual(['500']);
    expect(await entityOf('coach:600')).toEqual([]);

    expect(await splitCoachIds(db)).toEqual({ coachIds: 2, renamed: 1, split: 1, rostersMoved: 1 });

    // só técnico: a mesma pessoa, agora coach:500
    expect(await providerIdOf(pure)).toEqual(['coach:500']);
    // jogador e técnico: o jogador fica com a pessoa (sem a foto de técnico); o técnico é uma pessoa nova
    expect(await providerIdOf(mixed)).toEqual(['600']);
    const [coachId] = await entityOf('coach:600');
    const [coach] = await db.select().from(person).where(eq(person.id, coachId!));
    expect(coach).toMatchObject({ name: 'Técnico X' });
    expect(coach!.photoAssetId).not.toBeNull();
    expect((await db.select().from(person).where(eq(person.id, mixed)))[0]!.photoAssetId).toBeNull();
    expect(
      (await db.select().from(roster).where(eq(roster.role, 'coach'))).map((r) => r.personId).sort(),
    ).toEqual([pure, coachId!].sort());
    expect(await providerIdOf(onlyPlayer)).toEqual(['700']);

    expect(await splitCoachIds(db)).toEqual({ coachIds: 2, renamed: 0, split: 0, rostersMoved: 0 });

    // o normalizador grava o perfil do técnico na pessoa coach:600, sem criar outra
    const coachItem = {
      id: 600,
      name: 'Técnico X',
      firstname: 'Técnico',
      lastname: 'X',
      age: 50,
      birth: { date: '1976-02-02', place: null, country: null },
      nationality: 'Brazil',
      height: null,
      weight: null,
      photo: 'https://media.api-sports.io/football/coachs/600.png',
      team: { id: 121, name: 'Palmeiras', logo: null },
      career: [{ team: { id: 121, name: 'Palmeiras', logo: null }, start: '2026-01-01', end: null }],
    } as unknown as ApiCoachItem;
    await upsertBatch(db, normalizeCoaches([coachItem], new Date(), { team: '121' }));
    expect(await entityOf('coach:600')).toEqual([coachId]);
    expect((await db.select().from(person).where(eq(person.id, coachId!)))[0]).toMatchObject({
      birthDate: '1976-02-02',
    });
    expect((await db.select().from(person).where(eq(person.id, mixed)))[0]!.birthDate).toBeNull();
  });
});
