import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import {
  closeDb,
  competition,
  createDb,
  event,
  eventParticipant,
  participant,
  runMigrations,
  sport,
  type Database,
} from '@galaxie/db';

/** Banco descartável por arquivo de teste, criado a partir de DATABASE_URL (ver packages/db/test). */
export function disposableDb(): { setup: () => Promise<Database>; teardown: () => Promise<void> } {
  const adminUrl = process.env.DATABASE_URL;
  if (!adminUrl) throw new Error('DATABASE_URL é obrigatória para os testes de integração (pnpm infra:up).');
  const dbName = `galaxie_test_${randomBytes(4).toString('hex')}`;
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  let admin: postgres.Sql | undefined;
  let db: Database | undefined;
  return {
    setup: async () => {
      admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
      await admin.unsafe(`CREATE DATABASE ${dbName}`);
      await runMigrations(u.toString());
      db = createDb(u.toString(), { max: 5 });
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

/** Semeia esporte, Libertadores (tier 1) e um jogo Palmeiras × Fluminense. */
export async function seedEvent(
  db: Database,
  opts: { startsAt: Date; tier?: number; slug?: string; countryCode?: string },
): Promise<{ eventId: string; competitionId: string }> {
  await db
    .insert(sport)
    .values({ slug: 'football', name: { 'pt-BR': 'Futebol' } })
    .onConflictDoNothing();
  const slug = opts.slug ?? 'conmebol-libertadores';
  const [comp] = await db
    .insert(competition)
    .values({
      sport: 'football',
      slug: `${slug}`,
      name: 'CONMEBOL Libertadores',
      type: 'cup',
      tier: opts.tier ?? 1,
      countryCode: null,
    })
    .onConflictDoUpdate({ target: [competition.sport, competition.slug], set: { tier: opts.tier ?? 1 } })
    .returning();
  const [home, away] = await db
    .insert(participant)
    .values([
      { sport: 'football', kind: 'club', name: 'Palmeiras' },
      { sport: 'football', kind: 'club', name: 'Fluminense' },
    ])
    .returning();
  const [ev] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: comp!.id,
      startsAt: opts.startsAt,
      endsAtExpected: new Date(opts.startsAt.getTime() + 115 * 60_000),
    })
    .returning();
  await db.insert(eventParticipant).values([
    { eventId: ev!.id, participantId: home!.id, side: 'home' },
    { eventId: ev!.id, participantId: away!.id, side: 'away' },
  ]);
  return { eventId: ev!.id, competitionId: comp!.id };
}
