import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import postgres from 'postgres';
import {
  closeDb,
  competition,
  country,
  createDb,
  providerMap,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';
import { upsertBatch } from '@galaxie/ingestor';
import { normalizeFixtures, type ApiFixture } from '@galaxie/providers';

/** Banco descartável por arquivo de teste, criado a partir de DATABASE_URL (ver packages/db/test). */
export function disposableDb(): { setup: () => Promise<Database>; teardown: () => Promise<void> } {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
  const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  const testUrl = u.toString();
  let admin: postgres.Sql | undefined;
  let db: Database | undefined;
  return {
    setup: async () => {
      admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await admin.unsafe(`CREATE DATABASE ${dbName}`);
      await runMigrations(testUrl);
      db = createDb(testUrl, { max: 5 });
      return db;
    },
    teardown: async () => {
      if (db) await closeDb(db);
      if (admin) {
        await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        await admin.end();
      }
    },
  };
}

const FIXTURES = new URL('../../../packages/providers/test/fixtures/api-sports/football/', import.meta.url);

/** Partida real recortada (fixtures?id=1492407: Palmeiras 4 × 1 Corinthians, com timeline e estatísticas). */
export function detailFixture(): ApiFixture {
  const env = JSON.parse(readFileSync(new URL('fixtures-id-1492407.json', FIXTURES), 'utf8')) as {
    response: ApiFixture[];
  };
  return structuredClone(env.response[0]!);
}

/** Partida sintética no formato v3 a partir do fixture real (sem timeline). */
export function syntheticFixture(opts: {
  id: number;
  league: { id: number; name: string; country: string; season: number; round: string };
  date: string;
  home: { id: number; name: string };
  away: { id: number; name: string };
  status: 'NS' | 'FT';
  goals?: { home: number; away: number };
}): ApiFixture {
  const f = detailFixture() as ApiFixture & Record<string, unknown>;
  for (const k of ['events', 'lineups', 'statistics', 'players']) delete f[k];
  const ts = Date.parse(opts.date) / 1000;
  f.fixture = {
    ...f.fixture,
    id: opts.id,
    date: opts.date.replace('Z', '+00:00'),
    timestamp: ts,
    periods: opts.status === 'FT' ? { first: ts, second: ts + 3600 } : { first: null, second: null },
    status:
      opts.status === 'FT'
        ? { long: 'Match Finished', short: 'FT', elapsed: 90, extra: null }
        : { long: 'Not Started', short: 'NS', elapsed: null, extra: null },
  };
  f.league = { ...f.league, ...opts.league };
  f.teams = {
    home: { ...f.teams.home, id: opts.home.id, name: opts.home.name, winner: null },
    away: { ...f.teams.away, id: opts.away.id, name: opts.away.name, winner: null },
  };
  const g = opts.goals ?? null;
  f.goals = { home: g?.home ?? null, away: g?.away ?? null };
  f.score = {
    halftime: { home: g ? 0 : null, away: g ? 0 : null },
    fulltime: { home: g?.home ?? null, away: g?.away ?? null },
    extratime: { home: null, away: null },
    penalty: { home: null, away: null },
  };
  return f;
}

/** Catálogo mínimo: futebol, países e competições ligadas aos IDs da api-sports. */
export async function seedCatalog(
  db: Database,
  competitions: {
    slug: string;
    name: string;
    leagueId: number;
    tier: number;
    type: 'league' | 'cup';
    country: string;
  }[],
): Promise<Map<string, string>> {
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
  await db
    .insert(country)
    .values([
      { code: 'BR', name: { en: 'Brazil', 'pt-BR': 'Brasil' } },
      { code: 'WORLD', name: { en: 'World' } },
    ])
    .onConflictDoNothing();
  const ids = new Map<string, string>();
  for (const c of competitions) {
    const [row] = await db
      .insert(competition)
      .values({
        sport: 'football',
        slug: c.slug,
        name: c.name,
        countryCode: c.country,
        type: c.type,
        tier: c.tier,
      })
      .returning();
    await db.insert(providerMap).values({
      entityType: 'competition',
      entityId: row!.id,
      provider: 'api-sports',
      sport: 'football',
      providerId: String(c.leagueId),
    });
    ids.set(c.slug, row!.id);
  }
  return ids;
}

export async function ingest(db: Database, fixtures: ApiFixture[], observedAt: Date): Promise<void> {
  await upsertBatch(db, normalizeFixtures(fixtures, observedAt));
}

export async function idOf(
  db: Database,
  entityType: 'event' | 'participant',
  providerId: number | string,
): Promise<string> {
  const [row] = await db
    .select({ id: providerMap.entityId })
    .from(providerMap)
    .where(
      and(
        eq(providerMap.provider, 'api-sports'),
        eq(providerMap.entityType, entityType),
        eq(providerMap.providerId, String(providerId)),
      ),
    );
  if (!row) throw new Error(`${entityType} ${providerId} não encontrado`);
  return row.id;
}
