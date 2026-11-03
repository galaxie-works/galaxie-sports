/**
 * Relógio dos eventos (docs/04 §3.1): scheduled → starting em T-10 e, sem dado fresco da fonte,
 * starting → live no apito e live → finished em ends_at_expected. Idempotente; rode a cada minuto.
 *   pnpm --filter @galaxie/ingestor events:clock [esporte]
 */
import { closeDb, createDb } from '@galaxie/db';
import { advanceEventClock } from '@galaxie/core-writer';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('Defina DATABASE_URL (.env).');

// no serviço do ao vivo, os tempos curtos do perfil `live` (a regra do dbProfileFromEnv, sem carregar o contexto
// inteiro neste job de 64 MB de heap)
const live = process.env.SCHEDULER_PROFILE?.trim().toLowerCase() === 'live';
const db = createDb(url, live ? { profile: 'live' } : {});
const sport = process.argv[2];
const result = await advanceEventClock(db, new Date(), sport ? { sport } : {});
console.log(
  `Eventos examinados: ${result.examined} · com mudança: ${result.changed} · transições registradas: ${result.transitions}`,
);
await closeDb(db);
