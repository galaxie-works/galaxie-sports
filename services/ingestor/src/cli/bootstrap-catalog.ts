/**
 * Bootstrap do catálogo global do futebol (issue #12): ~8 chamadas, reaproveitando o que já estiver no raw.
 *   pnpm --filter @galaxie/ingestor bootstrap:catalog --plan   # só mostra o que gastaria cota
 *   pnpm --filter @galaxie/ingestor bootstrap:catalog          # executa
 *   pnpm --filter @galaxie/ingestor bootstrap:catalog --sem-live
 *     # planeja o dia sem ao vivo (LIVE = 0, DAILY = já usado) para liberar a folga ao BOOTSTRAP.
 *     # A política padrão protege 40 + 40 chamadas para sync diário e ao vivo e cede só 5 ao bootstrap.
 * Sem APISPORTS_KEY (ex.: depois de snapshot:import) roda em modo offline: reprocessa o catálogo a partir
 * do raw, sem chamar o fornecedor.
 */
import { resolve } from 'node:path';
import { closeDb, createDb } from '@galaxie/db';
import { planFootballCatalog, runFootballCatalogJob, summarize } from '../bootstrap/football-catalog-job.js';
import { loadFootballCatalog } from '../catalog/catalog-config.js';
import { contextFromEnv } from '../context.js';
import { logger, report } from '../logger.js';

const catalogPath = resolve('../../config/competitions/football.yaml');

if (process.argv.includes('--plan')) {
  if (!process.env.DATABASE_URL) throw new Error('Defina DATABASE_URL (.env).');
  const db = createDb(process.env.DATABASE_URL);
  const plan = await planFootballCatalog(db);
  report('Plano do bootstrap do catálogo', plan);
  report('Chamadas que gastariam cota', {
    network_calls: plan.filter((p) => p.source === 'network').length,
  });
  await closeDb(db);
} else {
  const { db, client, governor, offline } = contextFromEnv();
  if (offline) console.log('Sem APISPORTS_KEY: modo offline — reprocessa o catálogo a partir do raw.');
  if (process.argv.includes('--sem-live')) {
    const usage = await governor.usage('football');
    await governor.plan('football', usage.dayUtc, { LIVE: 0, DAILY: usage.used.DAILY });
    logger.info(
      { sport: 'football', day_utc: usage.dayUtc },
      'dia planejado sem ao vivo: folga liberada para o BOOTSTRAP',
    );
  }
  const catalog = await loadFootballCatalog(catalogPath);
  const result = await runFootballCatalogJob(db, client, catalog);
  report('Chamadas do bootstrap do catálogo', result.calls);
  report('Catálogo gravado', { stats: result.stats, catalog: summarize(result.check) });
  const problems = result.check.filter((c) => c.status !== 'ok');
  if (problems.length) report('Competições com divergência no catálogo', problems);
  await closeDb(db);
}
