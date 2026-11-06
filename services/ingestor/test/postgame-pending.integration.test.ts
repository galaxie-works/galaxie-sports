/**
 * Pendentes do fechamento pós-jogo no Postgres: `running` conta só os jogos que ainda podem estar em campo, até 1 h
 * depois do fim previsto. Quem define o intervalo curto ou longo da data é esse número (postgame/plan.ts).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { event, sport, type Database } from '@galaxie/db';
import { pendingDays, postgameSports } from '../src/postgame/plan.js';
import { disposableDb } from './db.js';

const disposable = disposableDb();
let db: Database;

const NOW = new Date('2026-11-05T15:00:00Z');
const MIN = 60_000;

/** Jogo pendente: começou há `startedMin` minutos e tem o fim previsto há `endedMin` minutos. */
const game = (startedMin: number, endedMin: number, status: 'live' | 'finished' = 'live') => ({
  sport: 'nba',
  status,
  statusSource: 'temporal' as const,
  startsAt: new Date(NOW.getTime() - startedMin * MIN),
  endsAtExpected: new Date(NOW.getTime() - endedMin * MIN),
});

beforeAll(async () => {
  db = await disposable.setup();
  await db.insert(sport).values({ slug: 'nba', name: { 'pt-BR': 'NBA' } });
});

afterAll(async () => {
  await disposable.teardown();
});

describe('fechamento pós-jogo: pendentes por data', () => {
  it('separa os jogos que ainda podem estar em campo dos que passaram da folga', async () => {
    await db.insert(event).values([
      // 05/11: em campo, dentro da folga de 1 h, e já fora dela
      game(30, -85),
      game(170, 55, 'finished'),
      game(180, 65, 'finished'),
      // 04/11: o jogo que passou da meia-noite ainda está em campo; o outro passou da folga há horas
      game(16 * 60, -60),
      game(20 * 60, 18 * 60, 'finished'),
    ]);
    const sports = postgameSports({ POSTGAME_NBA: 'tempo-real', POSTGAME_NBA_MIN: '2' });
    const days = await pendingDays(
      db,
      sports.filter((s) => s.sport === 'nba'),
      NOW,
    );
    expect(days).toEqual([
      { sport: 'nba', date: '2026-11-04', pending: 2, running: 1 },
      { sport: 'nba', date: '2026-11-05', pending: 3, running: 2 },
    ]);
  });
});
