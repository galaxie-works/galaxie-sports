/**
 * Bootstrap do catálogo global do futebol (issue #12): ~8 chamadas, reaproveitando o que já estiver no raw.
 *   pnpm --filter @galaxie/ingestor bootstrap:catalog --plan   # só mostra o que gastaria cota
 *   pnpm --filter @galaxie/ingestor bootstrap:catalog          # executa
 *   pnpm --filter @galaxie/ingestor bootstrap:catalog --sem-live
 *     # planeja o dia sem ao vivo (LIVE = 0, DAILY = já usado) para liberar a folga ao BOOTSTRAP.
 *     # A política padrão protege 40 + 40 chamadas para sync diário e ao vivo e cede só 5 ao bootstrap.
 */
import { resolve } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { planFootballCatalog, runFootballCatalogJob, summarize } from '../bootstrap/football-catalog-job.js';
import { loadFootballCatalog } from '../catalog/catalog-config.js';
import { contextFromEnv } from '../context.js';

const catalogPath = resolve('../../config/competitions/football.yaml');

if (process.argv.includes('--plan')) {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(process.env.DATABASE_URL);
  const plan = await planFootballCatalog(db);
  console.table(plan);
  console.log(`Chamadas que gastariam cota: ${plan.filter((p) => p.source === 'network').length}`);
  await closeDb(db);
} else {
  const { db, client, governor } = contextFromEnv();
  if (process.argv.includes('--sem-live')) {
    const usage = await governor.usage('football');
    await governor.plan('football', usage.dayUtc, { LIVE: 0, DAILY: usage.used.DAILY });
    console.log(`Dia ${usage.dayUtc} planejado sem ao vivo: folga liberada para o BOOTSTRAP.`);
  }
  const catalog = await loadFootballCatalog(catalogPath);
  const result = await runFootballCatalogJob(db, client, catalog);
  console.table(result.calls);
  console.log('Gravado:', JSON.stringify(result.stats));
  console.log('Catálogo:', JSON.stringify(summarize(result.check)));
  const problems = result.check.filter((c) => c.status !== 'ok');
  if (problems.length) console.table(problems);
  await closeDb(db);
}
