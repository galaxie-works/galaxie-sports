import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Database } from '@galaxie/db';
import { loadEventCore } from '../src/context/event-core.js';
import { loadLastFinalBetween } from '../src/context/history.js';
import { disposableDb, idOf, ingest, seedCatalog, syntheticFixture } from './helpers.js';

const env = disposableDb();
let db: Database;

const CUP = { id: 7700, name: 'Copa Teste', country: 'Brazil', round: 'Final' };
const A = { id: 7701, name: 'Time A' };
const B = { id: 7702, name: 'Time B' };

/** Final encerrada, com o `winner` de cada lado como o fornecedor manda (null = empate). */
function final(
  id: number,
  season: number,
  date: string,
  home: typeof A,
  away: typeof A,
  goals: [number, number],
) {
  const f = syntheticFixture({
    id,
    league: { ...CUP, season },
    date,
    home,
    away,
    status: 'FT',
    goals: { home: goals[0], away: goals[1] },
  });
  const homeWon = goals[0] === goals[1] ? null : goals[0] > goals[1];
  f.teams.home.winner = homeWon;
  f.teams.away.winner = homeWon === null ? null : !homeWon;
  return f;
}

beforeAll(async () => {
  db = await env.setup();
  await seedCatalog(db, [
    { slug: 'copa-teste', name: 'Copa Teste', leagueId: 7700, tier: 1, type: 'cup', country: 'BR' },
  ]);
  const volta2026 = syntheticFixture({
    id: 7714,
    league: { ...CUP, season: 2026 },
    date: '2026-11-08T22:00:00Z',
    home: B,
    away: A,
    status: 'NS',
  });
  await ingest(
    db,
    [
      // final de 2025 em ida e volta: A 1 × 0 B e B 3 × 1 A — título do B no agregado (3 × 2)
      final(7711, 2025, '2025-11-01T22:00:00Z', A, B, [1, 0]),
      final(7712, 2025, '2025-11-08T22:00:00Z', B, A, [3, 1]),
      // final de 2026: a ida já foi (A 2 × 0 B); a volta é o jogo do cenário
      final(7713, 2026, '2026-11-01T22:00:00Z', A, B, [2, 0]),
      volta2026,
    ],
    new Date('2026-11-05T00:00:00Z'),
  );
}, 120_000);

afterAll(async () => {
  await env.teardown();
});

describe('última final entre os dois (histórico do cenário)', () => {
  it('na volta da final, a ida não é "a última final": vale a temporada anterior, pelo agregado', async () => {
    const core = (await loadEventCore(db, await idOf(db, 'event', 7714)))!;
    expect(core.stage?.kind).toBe('final');
    expect(await loadLastFinalBetween(db, core)).toEqual({
      season: 2025,
      home: 'Time B',
      away: 'Time A',
      home_goals: 3,
      away_goals: 2,
      // o B (mandante deste jogo) ficou com aquele título
      winner: 'home',
      legs: 2,
    });
  });
});
