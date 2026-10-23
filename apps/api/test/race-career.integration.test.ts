/**
 * Carreira na F1 (`/v1/teams/{id}/career`): título só de temporada encerrada. A liderança de uma temporada em
 * andamento (corrida ainda por vir) aparece como posição provisória (`final: false`) e não conta título.
 */
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  closeDb,
  competition,
  createDb,
  event,
  participant,
  runMigrations,
  season,
  sport,
  sportEventDetail,
  standing,
  type Database,
} from '@galaxie/db';
import { loadRaceCareer } from '../src/teams/career.js';

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
let driverId: string;
const THIS_YEAR = new Date().getUTCFullYear();

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
  const seasons = await db
    .insert(season)
    .values([
      { competitionId: champ!.id, year: 1988, label: '1988' },
      { competitionId: champ!.id, year: THIS_YEAR, label: String(THIS_YEAR) },
    ])
    .returning({ id: season.id, year: season.year });
  const [driver] = await db
    .insert(participant)
    .values({ sport: 'formula-1', kind: 'driver', name: 'Piloto Teste' })
    .returning({ id: participant.id });
  driverId = driver!.id;
  for (const s of seasons)
    await db
      .insert(standing)
      .values({ seasonId: s.id, group: 'drivers', participantId: driverId, rank: 1, points: 90 });
  // a temporada atual ainda tem corrida por vir
  const current = seasons.find((s) => s.year === THIS_YEAR)!;
  const startsAt = new Date(Date.now() + 7 * 86_400_000);
  const [race] = await db
    .insert(event)
    .values({
      sport: 'formula-1',
      competitionId: champ!.id,
      seasonId: current.id,
      startsAt,
      endsAtExpected: new Date(startsAt.getTime() + 2 * 3_600_000),
    })
    .returning({ id: event.id });
  await db.insert(sportEventDetail).values({
    eventId: race!.id,
    sport: 'formula-1',
    provider: 'teste',
    providerEventId: 'race-1',
    kind: 'race',
    summary: { type: 'Race' },
  });
}, 120_000);

afterAll(async () => {
  await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('carreira na F1: títulos', () => {
  it('liderança da temporada em andamento não é título', async () => {
    const career = await loadRaceCareer(db, { id: driverId, kind: 'driver' }, 'pt-BR', undefined);
    expect(career.titles).toEqual([1988]);
    expect(career.totals.titles).toBe(1);
    const byYear = new Map(career.seasons.map((s) => [s.year, s]));
    expect(byYear.get(1988)).toMatchObject({ position: 1, final: true });
    expect(byYear.get(THIS_YEAR)).toMatchObject({ position: 1, final: false });
  });
});
