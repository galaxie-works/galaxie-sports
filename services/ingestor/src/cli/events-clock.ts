/**
 * Relógio dos eventos (docs/04 §3.1): scheduled → starting em T-10 e, sem dado fresco da fonte,
 * starting → live no apito e live → finished em ends_at_expected. Idempotente; rode a cada minuto.
 *   pnpm --filter @galaxie/ingestor events:clock [esporte]
 */
import { closeDb, createDb } from '@galaxie/db';
import { advanceEventClock } from '../normalize/event-state.js';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

const db = createDb(url);
const sport = process.argv[2];
const result = await advanceEventClock(db, new Date(), sport ? { sport } : {});
console.log(
  `Eventos examinados: ${result.examined} · com mudança: ${result.changed} · transições registradas: ${result.transitions}`,
);
await closeDb(db);
