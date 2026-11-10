/**
 * Manutenção da carteira da Cosmos AI (#992, #994), a cada 5 minutos: devolve as reservas abertas que passaram do
 * prazo, tira do saldo o teste vencido e cobra as recargas automáticas pendentes (só com STRIPE_SECRET_KEY; o
 * crédito entra pelo webhook). Não gasta cota do fornecedor nem IA.
 *   pnpm --filter @galaxie/ingestor cosmos:upkeep
 */
import { expireTrials, processRecharges, releaseExpired } from '@galaxie/cosmos';
import { closeDb, createDb } from '@galaxie/db';
import { report } from '../logger.js';
import { runCli } from './job-cli.js';

await runCli(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(url, { max: 2 });
  try {
    const now = new Date();
    const reservations = await releaseExpired(db, now);
    const trials = await expireTrials(db, now);
    const secret = process.env.STRIPE_SECRET_KEY?.trim();
    const recharges = secret ? await processRecharges(db, secret, { now }) : null;
    report('Cosmos AI: manutenção da carteira', [
      {
        'reservas vencidas devolvidas': reservations,
        'testes vencidos': trials,
        'recargas cobradas': recharges ? recharges.charged : '— (sem STRIPE_SECRET_KEY)',
        'recargas recusadas': recharges ? recharges.failed : '—',
      },
    ]);
  } finally {
    await closeDb(db);
  }
});
