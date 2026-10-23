import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asset,
  competition,
  event,
  footballFixture,
  person,
  providerMap,
  sport,
  type Database,
} from '@galaxie/db';
import { profilesJob, profileTargets } from '../src/jobs/profiles-job.js';
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

async function personWith(providerId: string, extra: { birthDate?: string; photo?: boolean } = {}) {
  const photo = extra.photo
    ? (
        await db
          .insert(asset)
          .values({ kind: 'player', sourceUrl: `https://x/${providerId}.png` })
          .returning()
      )[0]!.id
    : null;
  const [p] = await db
    .insert(person)
    .values({ name: `P ${providerId}`, birthDate: extra.birthDate ?? null, photoAssetId: photo })
    .returning();
  await db
    .insert(providerMap)
    .values({ entityType: 'person', entityId: p!.id, provider: 'api-sports', sport: 'football', providerId });
}

let seq = 0;
async function game(tier: number, startsAt: string, coach: number, players: number[]) {
  const [c] = await db
    .insert(competition)
    .values({ sport: 'football', slug: `comp-${++seq}`, name: 'Comp', type: 'league', tier })
    .returning();
  const at = new Date(startsAt);
  const [e] = await db
    .insert(event)
    .values({
      sport: 'football',
      competitionId: c!.id,
      startsAt: at,
      endsAtExpected: new Date(at.getTime() + 7_200_000),
    })
    .returning();
  await db.insert(footballFixture).values({
    eventId: e!.id,
    providerFixtureId: 700_000 + seq,
    summary: {},
    detail: {
      lineups: [
        {
          team: { id: 1 },
          coach: { id: coach, name: 'T' },
          startXI: players.map((id) => ({ player: { id } })),
          substitutes: [],
        },
      ],
    },
  });
}

describe('perfis das pessoas sem nascimento', () => {
  it('escolhe quem jogou desde a data em tier ≤ 2, sem foto e sem nascimento; técnicos à parte; ignora o id 0', async () => {
    await personWith('10'); // alvo, 2 jogos
    await personWith('11'); // alvo, 1 jogo
    await personWith('12', { birthDate: '2000-01-01' }); // já tem nascimento
    await personWith('13', { photo: true }); // já tem foto
    await personWith('14'); // só em tier 3
    await personWith('15'); // só em 2025
    await personWith('coach:50'); // técnico alvo
    await personWith('coach:0'); // técnico desconhecido da api-sports
    await game(1, '2026-03-01T20:00:00Z', 50, [10, 11, 12, 13]);
    await game(2, '2026-04-01T20:00:00Z', 0, [10]);
    await game(3, '2026-05-01T20:00:00Z', 50, [14]);
    await game(1, '2025-05-01T20:00:00Z', 50, [15]);

    const targets = await profileTargets(db, { since: new Date('2026-01-01T00:00:00Z'), maxTier: 2 });
    expect(targets).toEqual({ players: [10, 11], coaches: [50] });

    const spec = profilesJob(async () => targets);
    const [players, coaches] = await Promise.all(spec.phases.map((p) => p.build()));
    expect(players!.map((r) => [r.endpoint, r.params])).toEqual([
      ['/players/profiles', { player: '10' }],
      ['/players/profiles', { player: '11' }],
    ]);
    expect(coaches!.map((r) => [r.endpoint, r.params])).toEqual([['/coachs', { id: '50' }]]);
  });
});
