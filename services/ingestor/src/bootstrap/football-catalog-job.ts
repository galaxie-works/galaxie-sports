import {
  normalizeParams,
  PgRawStore,
  requestHash,
  ttlFor,
  type ApiSportsClient,
  type Envelope,
} from '@galaxie/apisports-client';
import { jobRun, type Database } from '@galaxie/db';
import { eq } from 'drizzle-orm';
import type { CatalogCompetition } from '../catalog/catalog-config.js';
import { logger } from '../logger.js';
import {
  buildCatalogRows,
  checkCatalog,
  upsertFootballCatalog,
  type ApiCountry,
  type ApiLeague,
  type CatalogCheck,
  type UpsertStats,
} from '../catalog/football-catalog.js';

/** Referência global do futebol: ~8 chamadas trazem o catálogo inteiro (docs/03 §3, passo 1). */
export const FOOTBALL_REFERENCE_ENDPOINTS = [
  '/timezone',
  '/countries',
  '/leagues',
  '/leagues/seasons',
  '/teams/countries',
  '/odds/bookmakers',
  '/odds/bets',
  '/odds/live/bets',
] as const;

export interface PlannedCall {
  endpoint: string;
  source: 'cache' | 'network';
}

/** Mostra o que sairia do raw e o que gastaria cota — sem chamar o fornecedor. */
export async function planFootballCatalog(db: Database, now = new Date()): Promise<PlannedCall[]> {
  const store = new PgRawStore(db);
  const plan: PlannedCall[] = [];
  for (const endpoint of FOOTBALL_REFERENCE_ENDPOINTS) {
    const hash = requestHash('api-sports', 'football', endpoint, normalizeParams({}));
    const hit = await store.findFresh(hash, ttlFor(endpoint, {}, now), now);
    plan.push({ endpoint, source: hit ? 'cache' : 'network' });
  }
  return plan;
}

export interface CatalogJobResult {
  calls: PlannedCall[];
  stats: UpsertStats;
  check: CatalogCheck[];
}

/** Busca a referência global (prioridade BOOTSTRAP), grava o catálogo no core e confere o catálogo YAML. */
export async function runFootballCatalogJob(
  db: Database,
  client: ApiSportsClient,
  catalog: CatalogCompetition[],
): Promise<CatalogJobResult> {
  const [run] = await db
    .insert(jobRun)
    .values({ job: 'bootstrap:football-catalog', status: 'running' })
    .returning();
  const log = logger.child({
    job_id: `job-run:${run!.id}`,
    job: 'bootstrap:football-catalog',
    sport: 'football',
  });
  log.info('job iniciado');
  try {
    const calls: PlannedCall[] = [];
    const envelopes = new Map<string, Envelope>();
    for (const endpoint of FOOTBALL_REFERENCE_ENDPOINTS) {
      const res = await client.get({
        sport: 'football',
        endpoint,
        priority: 'BOOTSTRAP',
        jobId: `job-run:${run!.id}`,
      });
      calls.push({ endpoint, source: res.source });
      envelopes.set(endpoint, res.envelope);
    }

    const leagues = envelopes.get('/leagues')!.response as ApiLeague[];
    const countries = envelopes.get('/countries')!.response as ApiCountry[];
    const stats = await upsertFootballCatalog(db, buildCatalogRows(leagues, countries, catalog));
    const check = checkCatalog(catalog, leagues);

    await db
      .update(jobRun)
      .set({
        status: 'ok',
        finishedAt: new Date(),
        callsSpent: calls.filter((c) => c.source === 'network').length,
        stats: { ...stats, catalog: summarize(check) },
      })
      .where(eq(jobRun.id, run!.id));
    log.info(
      { calls_spent: calls.filter((c) => c.source === 'network').length, stats, catalog: summarize(check) },
      'job concluído',
    );
    return { calls, stats, check };
  } catch (err) {
    await db
      .update(jobRun)
      .set({ status: 'error', finishedAt: new Date(), error: String(err) })
      .where(eq(jobRun.id, run!.id));
    log.error({ err }, 'job falhou');
    throw err;
  }
}

export function summarize(check: CatalogCheck[]): Record<CatalogCheck['status'], number> {
  const out = { ok: 0, missing: 0, mismatch: 0, unverified: 0 };
  for (const c of check) out[c.status] += 1;
  return out;
}
