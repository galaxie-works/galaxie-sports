/**
 * Perfil do piloto de F1: os traços calculados do core (`/v1/teams/{id}/traits`: nível, pistas, companheiro) e o
 * perfil editorial (`/v1/teams/{id}/editorial`: o momento ligado ao evento pela rodada da temporada e o rival ao
 * participante pelo F1DB).
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  participant,
  providerMap,
  runMigrations,
  season,
  sport,
  sportEventDetail,
  standing,
  venue,
  type Database,
} from '@galaxie/db';
import type { LocatedEditorial } from '@galaxie/knowledge';
import { sql } from 'drizzle-orm';
import { loadBiography } from '../src/teams/biography.js';
import { driverF1dbId, editorialBody } from '../src/teams/editorial.js';
import { loadDriverTraits } from '../src/teams/traits.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;
let senna: string;
let prost: string;
const raceIds: string[] = [];

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 2 });
  await db.insert(sport).values({ slug: 'formula-1', name: { 'pt-BR': 'Fórmula 1' } });
  const [champ] = await db
    .insert(competition)
    .values({ sport: 'formula-1', slug: 'f1', name: 'Formula 1 World Championship', type: 'league' })
    .returning({ id: competition.id });
  const [s1988] = await db
    .insert(season)
    .values({ competitionId: champ!.id, year: 1988, label: '1988', endDate: '1988-11-13' })
    .returning({ id: season.id });
  const [monaco, suzuka] = await db
    .insert(venue)
    .values([{ name: 'Circuit de Monaco' }, { name: 'Suzuka International Racing Course' }])
    .returning({ id: venue.id });
  const drivers = await db
    .insert(participant)
    .values([
      { sport: 'formula-1', kind: 'driver', name: 'Ayrton Senna' },
      { sport: 'formula-1', kind: 'driver', name: 'Alain Prost' },
    ])
    .returning({ id: participant.id });
  [senna, prost] = [drivers[0]!.id, drivers[1]!.id];
  await db.insert(providerMap).values([
    {
      entityType: 'participant',
      entityId: senna,
      provider: 'f1db',
      sport: 'formula-1',
      providerId: 'driver-ayrton-senna',
    },
    {
      entityType: 'participant',
      entityId: prost,
      provider: 'f1db',
      sport: 'formula-1',
      providerId: 'driver-alain-prost',
    },
  ]);
  await db.insert(standing).values([
    { seasonId: s1988!.id, group: 'drivers', participantId: senna, rank: 1, points: 90 },
    { seasonId: s1988!.id, group: 'drivers', participantId: prost, rank: 2, points: 87 },
  ]);

  const mclaren = { id: 'mclaren', name: 'McLaren' };
  // três GPs de 1988 (rodadas 1 a 3 pela data): Mônaco duas vezes (para entrar nas pistas preferidas) e Suzuka
  const gps = [
    { day: '1988-05-15', venueId: monaco!.id, senna: [1, 1], prost: [2, 2] },
    { day: '1988-06-12', venueId: monaco!.id, senna: [1, null], prost: [2, 1] },
    { day: '1988-10-30', venueId: suzuka!.id, senna: [2, 1], prost: [1, 2] },
  ] as const;
  for (const [i, gp] of gps.entries()) {
    const startsAt = new Date(`${gp.day}T13:00:00Z`);
    const make = async (type: string) => {
      const [ev] = await db
        .insert(event)
        .values({
          sport: 'formula-1',
          competitionId: champ!.id,
          seasonId: s1988!.id,
          venueId: gp.venueId,
          status: 'finished',
          startsAt: type === 'Race' ? startsAt : new Date(startsAt.getTime() - 86_400_000),
          endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
        })
        .returning({ id: event.id });
      await db.insert(sportEventDetail).values({
        eventId: ev!.id,
        sport: 'formula-1',
        provider: 'f1db',
        providerEventId: `${type}-${i}`,
        kind: 'race',
        summary: { type, source: 'f1db', round: i + 1, circuit: { id: i === 2 ? 'suzuka' : 'monaco' } },
      });
      return ev!.id;
    };
    const race = await make('Race');
    raceIds.push(race);
    const quali = await make('Qualifying');
    const row = (pid: string, [grid, finish]: readonly [number, number | null]) => ({
      eventId: race,
      participantId: pid,
      side: 'grid' as const,
      position: finish ?? 20,
      result:
        finish == null
          ? { grid, position_text: 'DNF', time: 'DNF', team: mclaren }
          : { grid, position_text: String(finish), points: finish === 1 ? 9 : 6, team: mclaren },
    });
    await db.insert(eventParticipant).values([row(senna, gp.senna), row(prost, gp.prost)]);
    await db.insert(eventParticipant).values([
      {
        eventId: quali,
        participantId: senna,
        side: 'grid',
        position: gp.senna[0],
        result: { team: mclaren },
      },
      {
        eventId: quali,
        participantId: prost,
        side: 'grid',
        position: gp.prost[0],
        result: { team: mclaren },
      },
    ]);
  }
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('traços do piloto', () => {
  it('campeão é lenda; pistas, poles e o duelo com o companheiro saem do core', async () => {
    const t = await loadDriverTraits(db, senna, 'pt-BR', undefined);
    expect(t.tier).toBe('legend');
    expect(t.circuits.favorites.map((c) => [c.circuit.name, c.circuit.id, c.races, c.wins, c.poles])).toEqual(
      [['Circuit de Monaco', 'monaco', 2, 1, 2]],
    );
    expect(t.circuits.all).toHaveLength(2);
    expect(t.qualifying_vs_race).toMatchObject({ races: 3, poles: 2, avg_grid: 1.3 });
    expect(t.teammates.career).toEqual({ grid: { won: 2, lost: 1 }, race: { won: 2, lost: 0 } });
    expect(t.teammates.by_season[0]).toMatchObject({
      year: 1988,
      teammate: { id: prost, name: 'Alain Prost' },
      races: 3,
    });
    expect(t.consistency).toMatchObject({ races: 3, dnfs: 1, points: 18 });
  });

  it('sem título, a posição na história em GPs também faz a lenda', async () => {
    // a base de teste só tem dois pilotos: o vice está entre os 20 com mais GPs
    expect((await loadDriverTraits(db, prost, 'pt-BR', undefined)).tier).toBe('legend');
  });

  it('não largou (DNS) não conta como GP: nem nos traços, nem no nível pela posição em GPs', async () => {
    const [reserve] = await db
      .insert(participant)
      .values({ sport: 'formula-1', kind: 'driver', name: 'Piloto Reserva' })
      .returning({ id: participant.id });
    const lotus = { id: 'lotus', name: 'Lotus' };
    await db.insert(eventParticipant).values([
      // F1DB: o texto da posição; api-sports: sem posição, sem tempo e com 0 volta
      {
        eventId: raceIds[0]!,
        participantId: reserve!.id,
        side: 'grid',
        position: null,
        result: { position_text: 'DNS', grid: 20, team: lotus },
      },
      {
        eventId: raceIds[1]!,
        participantId: reserve!.id,
        side: 'grid',
        position: null,
        result: { laps: 0, team: lotus },
      },
    ]);
    const t = await loadDriverTraits(db, reserve!.id, 'pt-BR', undefined);
    expect(t.consistency.races).toBe(0);
    expect(t.qualifying_vs_race.races).toBe(0);
    // com as linhas contadas como largada, estaria entre os 20 com mais GPs (lenda)
    expect(t.tier).toBe('basic');
  });
});

describe('perfil editorial', () => {
  it('UUID ou slug f1-<id> levam ao id do F1DB', async () => {
    expect(await driverF1dbId(db, senna)).toEqual({ participantId: senna, f1dbId: 'ayrton-senna' });
    expect(await driverF1dbId(db, 'f1-ayrton-senna')).toEqual({
      participantId: senna,
      f1dbId: 'ayrton-senna',
    });
    expect(await driverF1dbId(db, 'palmeiras')).toBeNull();
  });

  it('o momento ganha o evento pela rodada e o rival, o participante', async () => {
    const p: LocatedEditorial = {
      file: 'formula-1/editorial/pt-BR.yaml',
      index: 0,
      locale: 'pt-BR',
      entry: {
        slug: 'f1-ayrton-senna',
        name: 'Ayrton Senna',
        f1db: { id: 'ayrton-senna' },
        tier: 'legend',
        bio: { text: 'Bio.', sources: ['https://pt.wikipedia.org/wiki/Ayrton_Senna'] },
        moments: [
          { year: 1988, round: 3, race: 'GP do Japão', text: 'Título.', source: 'https://x.org/1' },
          {
            year: 1988,
            round: 2,
            race: 'GP de Mônaco',
            wet: true,
            text: 'Batida.',
            source: 'https://x.org/2',
          },
        ],
        rivalries: [
          {
            driver: { f1db_id: 'alain-prost', name: 'Alain Prost' },
            text: 'Rival.',
            source: 'https://x.org/3',
          },
        ],
        review_status: 'approved',
      },
    };
    const body = await editorialBody(db, p, senna, 'pt-BR');
    expect(body.moments.map((m) => [m.race, m.event_id, m.wet])).toEqual([
      ['GP do Japão', raceIds[2], false],
      ['GP de Mônaco', raceIds[1], true],
    ]);
    expect(body.rivalries[0]!.driver).toEqual({ id: prost, f1db_id: 'alain-prost', name: 'Alain Prost' });
    expect(body).toMatchObject({
      style: null,
      strengths: [],
      text_locale: 'pt-BR',
      review_status: 'approved',
    });
  });
});

describe('biografia (gravada pelo f1:biografia)', () => {
  it('morte no GP marcado como fatal, família com o participante e o QID como fonte', async () => {
    await db.execute(sql`
      update core.participant
         set full_name = 'Ayrton Senna da Silva', birth_date = '1960-03-21', death_date = '1988-10-30',
             bio_facts = ${JSON.stringify({
               family: [{ relation: 'SIBLING', f1db_id: 'alain-prost', name: 'Alain Prost', gender: 'male' }],
               wikidata: { qid: 'Q10490', matched_by: 'driver_id', checked_at: '2026-10-24T00:00:00Z' },
             })}::jsonb
       where id = ${senna}::uuid`);
    await db.execute(sql`
      update core.event_participant set result = result || '{"status": "Fatal accident"}'::jsonb
       where event_id = ${raceIds[2]!}::uuid and participant_id = ${senna}::uuid`);
    const bio = await loadBiography(db, senna, 'pt-BR');
    expect(bio).toMatchObject({
      full_name: 'Ayrton Senna da Silva',
      death: { date: '1988-10-30', age: 28, accident: true, race: { event_id: raceIds[2], session: 'race' } },
      family: [{ relation: 'SIBLING', driver: { id: prost, f1db_id: 'alain-prost' } }],
      sources: { wikidata: 'https://www.wikidata.org/wiki/Q10490' },
    });
  });
});
