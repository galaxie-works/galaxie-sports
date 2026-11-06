/** Estádio por nome e cidade quando a api-sports manda `venue.id` nulo: casamento no upsert e acerto do que já estava no banco. */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { venuesByName, venueNameKey } from '@galaxie/core-writer';
import { event, footballFixture, sport, venue, type Database } from '@galaxie/db';
import { linkEventVenuesByName } from '../src/ops/venues-by-name.js';
import { disposableDb } from './db.js';

const testDb = disposableDb();
let db: Database;
let peron: string;

beforeAll(async () => {
  db = await testDb.setup();
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
  const [v] = await db
    .insert(venue)
    .values({ name: 'Estadio Presidente Perón', city: 'Avellaneda' })
    .returning();
  peron = v!.id;
  await db.insert(venue).values([
    { name: 'Estadio Presidente Peron', city: 'Avellaneda' },
    { name: 'Estadio Municipal', city: 'Lima' },
    { name: 'Estadio Municipal', city: 'Lima' },
    { name: 'Estadio El Campín', city: 'Bogota' },
    { name: '  Estadio Atanasio Girardot ', city: 'Medellín' },
  ]);
}, 60_000);
afterAll(() => testDb.teardown());

let seq = 0;
async function fixtureWithVenue(
  name: string | null,
  city: string | null,
  providerId: number | null = null,
): Promise<string> {
  const startsAt = new Date('2026-09-01T20:00:00Z');
  const [e] = await db
    .insert(event)
    .values({ sport: 'football', startsAt, endsAtExpected: new Date(startsAt.getTime() + 7_200_000) })
    .returning();
  await db.insert(footballFixture).values({
    eventId: e!.id,
    providerFixtureId: 800_000 + ++seq,
    summary: { fixture: { venue: { id: providerId, name, city } } },
  });
  return e!.id;
}

const venueOf = async (eventId: string) =>
  (await db.select({ v: event.venueId }).from(event).where(eq(event.id, eventId)))[0]?.v ?? null;

describe('estádio por nome e cidade', () => {
  it('venuesByName: só o casamento único de nome + cidade, sem caixa', async () => {
    const found = await venuesByName(db, [
      { name: 'ESTADIO EL CAMPÍN', city: 'bogota' },
      { name: 'Estadio Municipal', city: 'Lima' },
      { name: 'Estadio El Campín', city: 'Medellín' },
      { name: 'Estadio Atanasio Girardot', city: 'Medellín' },
    ]);
    expect([...found.keys()].sort()).toEqual(
      [
        venueNameKey({ name: 'Estadio Atanasio Girardot', city: 'Medellín' }),
        venueNameKey({ name: 'ESTADIO EL CAMPÍN', city: 'bogota' }),
      ].sort(),
    );
  });

  it('linkEventVenuesByName: liga o jogo antigo sem estádio; ambíguo e sem nome ficam; plano não grava', async () => {
    const campin = await fixtureWithVenue('Estadio El Campín', 'Bogota');
    const ambiguo = await fixtureWithVenue('Estadio Municipal', 'Lima');
    const semNome = await fixtureWithVenue(null, 'Lima');
    const acento = await fixtureWithVenue('Estadio Presidente Perón', 'Avellaneda');
    // com id do fornecedor (sem mapa aqui) a ligação é pelo provider_map, nunca pelo nome
    const comId = await fixtureWithVenue('Estadio El Campín', 'Bogota', 4321);

    expect(await linkEventVenuesByName(db, { dryRun: true })).toEqual({ candidates: 3, linked: 2 });
    expect(await venueOf(campin)).toBeNull();

    expect(await linkEventVenuesByName(db)).toEqual({ candidates: 3, linked: 2 });
    expect(await venueOf(campin)).not.toBeNull();
    expect(await venueOf(acento)).toBe(peron);
    expect(await venueOf(ambiguo)).toBeNull();
    expect(await venueOf(semNome)).toBeNull();
    expect(await venueOf(comId)).toBeNull();

    // idempotente
    expect(await linkEventVenuesByName(db)).toEqual({ candidates: 1, linked: 0 });
  });
});
