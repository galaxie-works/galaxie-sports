import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { participant, person, providerMap, sport, type Database } from '@galaxie/db';
import { saveTeamMatches, type TeamMatch, type TeamResolution } from '../src/assets/wikidata-teams.js';
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

const map = (entityType: string, entityId: string, provider: string, providerId: string) =>
  db.insert(providerMap).values({ entityType, entityId, provider, sport: 'football', providerId });

describe('gravação do casamento pelo time', () => {
  it('preenche nascimento e nacionalidade só onde faltam, guarda os QIDs da pessoa e do time', async () => {
    const [empty] = await db.insert(person).values({ name: 'J. Duran' }).returning();
    const [known] = await db
      .insert(person)
      .values({ name: 'H. Gonzalez', nationality: 'Paraguay' })
      .returning();
    await map('person', empty!.id, 'api-sports', '639962');
    await map('person', known!.id, 'api-sports', '636515');
    const [team] = await db
      .insert(participant)
      .values({ sport: 'football', kind: 'club', name: 'Real Cartagena' })
      .returning();
    await map('participant', team!.id, 'api-sports', '1137');

    const m = (personId: string, providerId: string, qid: string, countries: string[]): TeamMatch => ({
      candidate: {
        personId,
        providerId,
        name: '',
        fullName: null,
        nationality: null,
        age: 22,
        ageAt: '2026-08-01',
        teams: ['1137'],
      },
      player: {
        qid,
        birthDate: '2004-03-10',
        birthPrecision: 11,
        labels: [],
        countries,
        image: null,
        teams: ['Q100'],
      },
    });
    const teams = new Map<string, TeamResolution>([['1137', { qid: 'Q100' }]]);
    const r = await saveTeamMatches(
      db,
      [m(empty!.id, '639962', 'Q1', ['Colombia']), m(known!.id, '636515', 'Q2', ['Colombia'])],
      teams,
    );
    expect(r).toEqual({ linked: 2, birthDates: 2, nationalities: 1, conflicts: 0 });

    const [e] = await db.select().from(person).where(eq(person.id, empty!.id));
    expect(e).toMatchObject({ birthDate: '2004-03-10', nationality: 'Colombia' });
    // nacionalidade conhecida não é trocada
    const [k] = await db.select().from(person).where(eq(person.id, known!.id));
    expect(k).toMatchObject({ birthDate: '2004-03-10', nationality: 'Paraguay' });
    const wd = await db
      .select({ type: providerMap.entityType, id: providerMap.providerId })
      .from(providerMap)
      .where(and(eq(providerMap.provider, 'wikidata')));
    expect(wd.map((w) => `${w.type}:${w.id}`).sort()).toEqual(['participant:Q100', 'person:Q1', 'person:Q2']);

    // de novo: nada muda, nenhum valor apagado
    expect(await saveTeamMatches(db, [m(empty!.id, '639962', 'Q1', [])], teams)).toEqual({
      linked: 1,
      birthDates: 0,
      nationalities: 0,
      conflicts: 0,
    });
    expect((await db.select().from(person).where(eq(person.id, empty!.id)))[0]).toMatchObject({
      nationality: 'Colombia',
    });

    // o QID Q1 já é de outra pessoa: nem nascimento nem nacionalidade de Q1 vão para esta
    const [other] = await db.insert(person).values({ name: 'J. Duran' }).returning();
    await map('person', other!.id, 'api-sports', '700001');
    expect(await saveTeamMatches(db, [m(other!.id, '700001', 'Q1', ['Colombia'])], teams)).toEqual({
      linked: 0,
      birthDates: 0,
      nationalities: 0,
      conflicts: 1,
    });
    expect((await db.select().from(person).where(eq(person.id, other!.id)))[0]).toMatchObject({
      birthDate: null,
      nationality: null,
    });
    // a pessoa já ligada a outro QID (Q1) também não é enriquecida por um QID novo
    expect(await saveTeamMatches(db, [m(empty!.id, '639962', 'Q9', ['Spain'])], teams)).toMatchObject({
      linked: 0,
      conflicts: 1,
    });
    // nascimento só com o ano: liga o QID e a nacionalidade, sem gravar a data
    const [yearOnly] = await db.insert(person).values({ name: 'P. Ano' }).returning();
    await map('person', yearOnly!.id, 'api-sports', '700002');
    const imprecise = m(yearOnly!.id, '700002', 'Q3', ['Chile']);
    imprecise.player.birthPrecision = 9;
    expect(await saveTeamMatches(db, [imprecise], teams)).toEqual({
      linked: 1,
      birthDates: 0,
      nationalities: 1,
      conflicts: 0,
    });
    expect((await db.select().from(person).where(eq(person.id, yearOnly!.id)))[0]).toMatchObject({
      birthDate: null,
      nationality: 'Chile',
    });
    const people = await db
      .select({ id: providerMap.providerId })
      .from(providerMap)
      .where(and(eq(providerMap.provider, 'wikidata'), eq(providerMap.entityType, 'person')));
    expect(people.map((w) => w.id).sort()).toEqual(['Q1', 'Q2', 'Q3']);
  });
});
