import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  apiResponse,
  closeDb,
  competition,
  country,
  createDb,
  event,
  eventParticipant,
  participant,
  providerMap,
  quotaLedger,
  runMigrations,
  sport,
  type Database,
} from '../src/index.js';

const adminUrl = process.env.DATABASE_URL;
if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');

// Cada execução usa um banco descartável, para provar a migração "do zero".
const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
const testUrl = (() => {
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
})();

let admin: postgres.Sql;
let db: Database;

beforeAll(async () => {
  admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  await admin.unsafe(`CREATE DATABASE ${dbName}`);
  await runMigrations(testUrl);
  db = createDb(testUrl, { max: 2 });
}, 60_000);

afterAll(async () => {
  if (db) await closeDb(db);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('migrations', () => {
  it('são idempotentes', async () => {
    await expect(runMigrations(testUrl)).resolves.toBeUndefined();
  });

  it('criam os cinco schemas', async () => {
    const rows = await db.execute<{ schema_name: string }>(
      sql`select schema_name from information_schema.schemata where schema_name in ('raw','core','semantic','enrich','ops') order by 1`,
    );
    expect(rows.map((r) => r.schema_name)).toEqual(['core', 'enrich', 'ops', 'raw', 'semantic']);
  });
});

describe('uuid v7', () => {
  it('gera UUIDs versão 7, variante RFC e ordenáveis por tempo', async () => {
    const rows = await db.execute<{ id: string }>(
      sql`select public.uuid_generate_v7()::text as id from generate_series(1, 50)`,
    );
    const ids = rows.map((r) => r.id);
    for (const id of ids) {
      expect(id[14]).toBe('7');
      expect(['8', '9', 'a', 'b']).toContain(id[19]);
    }
    expect(new Set(ids).size).toBe(ids.length);
    const prefixes = ids.map((id) => id.slice(0, 13));
    expect([...prefixes].sort()).toEqual(prefixes);
  });
});

describe('modelo canônico', () => {
  it('grava um evento com participantes e mapeamento de provedor', async () => {
    await db.insert(sport).values({ slug: 'football', name: { 'pt-BR': 'Futebol', 'es-AR': 'Fútbol' } });
    await db.insert(country).values({ code: 'BR', name: { 'pt-BR': 'Brasil' }, iocCode: 'BRA' });
    const [libertadores] = await db
      .insert(competition)
      .values({
        sport: 'football',
        slug: 'libertadores',
        name: 'CONMEBOL Libertadores',
        type: 'cup',
        tier: 1,
        livePriority: 'high',
      })
      .returning();
    const [home, away] = await db
      .insert(participant)
      .values([
        { sport: 'football', kind: 'club', name: 'Palmeiras', countryCode: 'BR' },
        { sport: 'football', kind: 'club', name: 'Fluminense', countryCode: 'BR' },
      ])
      .returning();

    const startsAt = new Date('2026-10-22T00:30:00Z');
    const [ev] = await db
      .insert(event)
      .values({
        sport: 'football',
        competitionId: libertadores!.id,
        startsAt,
        endsAtExpected: new Date(startsAt.getTime() + 115 * 60_000),
        score: { home: null, away: null, aggregate: { home: 2, away: 1 } },
      })
      .returning();

    expect(ev!.id).toMatch(/^[0-9a-f-]{14}7/);
    expect(ev!.status).toBe('scheduled');
    expect(ev!.isStale).toBe(false);

    await db.insert(eventParticipant).values([
      { eventId: ev!.id, participantId: home!.id, side: 'home' },
      { eventId: ev!.id, participantId: away!.id, side: 'away' },
    ]);
    await db.insert(providerMap).values({
      entityType: 'participant',
      entityId: home!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: '121',
    });

    const mapped = await db.select().from(providerMap).where(eq(providerMap.providerId, '121'));
    expect(mapped[0]?.entityId).toBe(home!.id);

    await db.delete(event).where(eq(event.id, ev!.id));
    const remaining = await db.select().from(eventParticipant).where(eq(eventParticipant.eventId, ev!.id));
    expect(remaining).toHaveLength(0);
  });

  it('rejeita status de evento fora do enum', async () => {
    await expect(
      db.execute(sql`insert into core.event (sport, starts_at, ends_at_expected, status)
                     values ('football', now(), now(), 'halftime')`),
    ).rejects.toThrow();
  });
});

describe('raw e ops', () => {
  it('guarda a resposta bruta e o ledger de cota', async () => {
    await db.insert(apiResponse).values({
      sport: 'football',
      apiVersion: 'v3',
      endpoint: '/fixtures',
      params: { date: '2026-10-21' },
      requestHash: 'h1',
      statusCode: 200,
      results: 273,
      errors: [],
      body: { get: 'fixtures', results: 273, response: [] },
      bodyHash: 'b1',
      quotaRemaining: 93,
    });
    await db.insert(quotaLedger).values({
      api: 'football',
      dayUtc: '2026-10-21',
      priority: 'DAILY',
      endpoint: '/fixtures',
      requestHash: 'h1',
      outcome: 'ok',
      remainingAfter: 93,
    });
    const [row] = await db.select().from(apiResponse).where(eq(apiResponse.requestHash, 'h1'));
    expect(row?.provider).toBe('api-sports');
    expect(row?.results).toBe(273);
  });
});
