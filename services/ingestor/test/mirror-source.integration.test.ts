/**
 * Fonte do espelho dos outros esportes (#855): jogos e times pelo core, só com o id da api-sports; o encerrado pelo
 * relógio (sem dado do fornecedor) e o provisório ficam fora, e o tier acima do pedido também.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  competition,
  event,
  eventParticipant,
  participant,
  providerMap,
  season,
  sport,
  type Database,
} from '@galaxie/db';
import { PgSportMirrorSource } from '../src/jobs/mirror-source.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;
const NOW = new Date(Date.UTC(2026, 10, 7, 8));
const H = 3_600_000;

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values([{ slug: 'hockey', name: { 'pt-BR': 'Hóquei' } }]);
});

afterAll(async () => {
  await disposable.teardown();
});

async function seedLeague(providerId: string, tier: number) {
  const [comp] = await db
    .insert(competition)
    .values({ sport: 'hockey', slug: `liga-${providerId}`, name: providerId, type: 'league', tier })
    .returning();
  const [s] = await db
    .insert(season)
    .values({ competitionId: comp!.id, label: '2026', year: 2026, current: true })
    .returning();
  await db.insert(providerMap).values({
    entityType: 'competition',
    entityId: comp!.id,
    provider: 'api-sports',
    sport: 'hockey',
    providerId,
  });
  return { competitionId: comp!.id, seasonId: s!.id };
}

async function team(providerId: string) {
  const [p] = await db
    .insert(participant)
    .values({ sport: 'hockey', kind: 'club', name: providerId })
    .returning();
  await db.insert(providerMap).values({
    entityType: 'participant',
    entityId: p!.id,
    provider: 'api-sports',
    sport: 'hockey',
    providerId,
  });
  return p!.id;
}

async function game(
  league: { competitionId: string; seasonId: string },
  providerId: string,
  hoursFromNow: number,
  teams: [string, string],
  extra: Partial<typeof event.$inferInsert> = {},
) {
  const startsAt = new Date(NOW.getTime() + hoursFromNow * H);
  const [e] = await db
    .insert(event)
    .values({
      sport: 'hockey',
      competitionId: league.competitionId,
      seasonId: league.seasonId,
      startsAt,
      endsAtExpected: new Date(startsAt.getTime() + 3 * H),
      ...extra,
    })
    .returning();
  await db
    .insert(providerMap)
    .values({ entityType: 'event', entityId: e!.id, provider: 'api-sports', sport: 'hockey', providerId });
  await db.insert(eventParticipant).values([
    { eventId: e!.id, participantId: teams[0], side: 'home' },
    { eventId: e!.id, participantId: teams[1], side: 'away' },
  ]);
}

describe('PgSportMirrorSource', () => {
  it('jogos e times da api-sports na janela, sem encerrado pelo relógio, provisório, id não numérico ou tier alto', async () => {
    const top = await seedLeague('57', 1);
    const low = await seedLeague('300', 3);
    const [a, b] = [await team('11'), await team('12')];
    const [c, d] = [await team('21'), await team('x-22')];
    await game(top, '1001', -20, [a, b], { status: 'finished', statusSource: 'provider' });
    await game(top, '1002', -10, [a, b], { status: 'finished', statusSource: 'temporal' });
    await game(top, '1003', 10, [a, b]);
    await game(top, '1004', 12, [a, b], { isProvisional: true });
    await game(top, 'manual-1', 14, [a, b]);
    await game(top, '1005', -24 * 10, [a, b], { status: 'finished' }); // fora da janela
    await game(low, '2001', 5, [c, d]);

    const source = new PgSportMirrorSource(
      db,
      async () => [],
      () => NOW,
    );
    const from = new Date(NOW.getTime() - 72 * H);
    const to = new Date(NOW.getTime() + 48 * H);

    const games = await source.games('hockey', from, to, 2);
    expect(games.map((g) => g.id)).toEqual(['1001', '1003']);
    expect(games[0]).toMatchObject({ league: '57', year: 2026, tier: 1, status: 'finished' });
    expect((await source.games('hockey', from, to, 3)).map((g) => g.id)).toEqual(['1001', '2001', '1003']);

    expect(await source.teams('hockey', '57', 2026)).toEqual(['11', '12']);
    expect(await source.teams('hockey', '300', 2026)).toEqual(['21']);
    expect(await source.teams('hockey', '57', 2025)).toEqual([]);
    expect(await source.participants('hockey', from, to, [2026])).toEqual(['11', '12', '21']);
    expect(await source.participants('hockey', from, to, [2024])).toEqual([]);
    expect(await source.participants('hockey', from, to, [])).toEqual([]);
  });

  it('sem a referência no raw, nenhuma temporada (o grupo de referência a busca primeiro)', async () => {
    const source = new PgSportMirrorSource(
      db,
      async () => [],
      () => NOW,
    );
    expect(await source.seasons('hockey')).toEqual([]);
  });
});
