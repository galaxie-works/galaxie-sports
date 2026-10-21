import {
  ApiSportsError,
  normalizeParams,
  PgRawStore,
  PlanViolationError,
  QuotaExceededError,
  requestHash,
  ttlFor,
  type ApiSportsClient,
  type Envelope,
  type PlanLimits,
} from '@galaxie/apisports-client';
import { jobRun, type Database } from '@galaxie/db';
import { eq } from 'drizzle-orm';
import type { SportCatalogCompetition } from '../catalog/catalog-config.js';
import { upsertCatalog, type CatalogRows, type UpsertStats } from '../catalog/persist.js';
import {
  checkSportCatalog,
  estimateSeasonCalls,
  planSeasonCalls,
  SPORT_PROFILES,
  type OtherSport,
  type PlannedSeasonCall,
  type ReferenceResponses,
  type SportCatalogCheck,
} from '../catalog/sport-catalog.js';

export interface SportCallResult {
  endpoint: string;
  params?: Record<string, string>;
  source: 'cache' | 'network' | 'skipped' | 'deferred' | 'error';
  detail?: string;
}

export interface SeasonGamesConfig {
  maxTier: number;
  latestSeasons: number;
}

function seasonWindow(plan: PlanLimits): { min: number; max: number } | undefined {
  return plan.seasons;
}

// ─── plano (sem gastar cota) ─────────────────────────────────────────────────────────────────────

export interface SportPlan {
  sport: OtherSport;
  calls: { endpoint: string; params?: Record<string, string>; source: 'cache' | 'network' }[];
  /** true quando as chamadas de temporada foram estimadas pelo YAML (ainda não há /leagues no raw). */
  estimated: boolean;
}

/** Mostra o que sairia do raw e o que gastaria cota em cada esporte — sem chamar o fornecedor. */
export async function planSportCatalog(
  db: Database,
  sport: OtherSport,
  catalog: SportCatalogCompetition[],
  options: { plan: PlanLimits; games?: SeasonGamesConfig | undefined; now?: Date },
): Promise<SportPlan> {
  const now = options.now ?? new Date();
  const store = new PgRawStore(db);
  const profile = SPORT_PROFILES[sport];
  const calls: SportPlan['calls'] = [];
  const latest: ReferenceResponses = new Map();
  for (const endpoint of profile.reference) {
    const hash = requestHash('api-sports', sport, endpoint, normalizeParams({}));
    const fresh = await store.findFresh(hash, ttlFor(endpoint, {}, now), now);
    calls.push({ endpoint, source: fresh ? 'cache' : 'network' });
    const any = fresh ?? (await store.findFresh(hash, Number.POSITIVE_INFINITY, now));
    if (any) latest.set(endpoint, (any.body as Envelope).response);
  }

  let estimated = false;
  if (options.games) {
    const window = seasonWindow(options.plan);
    let planned: PlannedSeasonCall[];
    if (profile.required.every((e) => latest.has(e))) {
      const rows = profile.build(latest, { catalog, today: now });
      planned = planSeasonCalls(profile, rows, { ...options.games, seasonWindow: window });
    } else {
      estimated = true;
      planned = estimateSeasonCalls(profile, catalog, {
        ...options.games,
        seasonWindow: window,
        currentYear: now.getUTCFullYear(),
      });
    }
    for (const p of planned) {
      const params = normalizeParams(p.params);
      const hash = requestHash('api-sports', sport, p.endpoint, params);
      const fresh = await store.findFresh(hash, ttlFor(p.endpoint, params, now), now);
      calls.push({ endpoint: p.endpoint, params, source: fresh ? 'cache' : 'network' });
    }
  }
  return { sport, calls, estimated };
}

// ─── execução ────────────────────────────────────────────────────────────────────────────────────

export interface SportCatalogJobResult {
  sport: OtherSport;
  calls: SportCallResult[];
  stats: UpsertStats;
  check: SportCatalogCheck[];
}

export interface SportCatalogJobOptions {
  games?: SeasonGamesConfig | undefined;
  now?: Date;
}

/**
 * Bootstrap do catálogo de um esporte (prioridade BOOTSTRAP): endpoints de referência → core (países,
 * competições, temporadas, participantes/locais quando houver, assets) e conferência do YAML.
 * Com `games`, busca também a temporada inteira das competições prioritárias (só para o raw; a normalização
 * dos jogos em core.event é outra etapa).
 */
export async function runSportCatalogJob(
  db: Database,
  client: ApiSportsClient,
  sport: OtherSport,
  catalog: SportCatalogCompetition[],
  options: SportCatalogJobOptions = {},
): Promise<SportCatalogJobResult> {
  const profile = SPORT_PROFILES[sport];
  const [run] = await db
    .insert(jobRun)
    .values({ job: `bootstrap:${sport}-catalog`, status: 'running' })
    .returning();
  const jobId = `job-run:${run!.id}`;
  const calls: SportCallResult[] = [];
  const spent = () => calls.filter((c) => c.source === 'network').length;
  try {
    const responses: ReferenceResponses = new Map();
    let quotaDenied = false;
    for (const endpoint of profile.reference) {
      if (quotaDenied) {
        calls.push({ endpoint, source: 'deferred', detail: 'cota do dia esgotada' });
        continue;
      }
      try {
        const res = await client.get({ sport, endpoint, priority: 'BOOTSTRAP', jobId });
        calls.push({ endpoint, source: res.source });
        responses.set(endpoint, res.envelope.response);
      } catch (err) {
        if (err instanceof QuotaExceededError) {
          quotaDenied = true;
          calls.push({ endpoint, source: 'deferred', detail: err.reason });
        } else if (err instanceof ApiSportsError && !profile.required.includes(endpoint)) {
          // endpoint de referência opcional que a API não tem ou recusou: segue sem ele
          calls.push({ endpoint, source: 'error', detail: err.outcome });
        } else throw err;
      }
    }
    const missing = profile.required.filter((e) => !responses.has(e));
    if (missing.length) {
      throw new Error(`Faltam respostas obrigatórias de ${sport}: ${missing.join(', ')} (cota ou erro).`);
    }

    const now = options.now ?? new Date();
    const rows: CatalogRows = profile.build(responses, { catalog, today: now });
    const stats = await upsertCatalog(db, sport, rows);
    const check = checkSportCatalog(catalog, rows);

    if (options.games) {
      const planned = planSeasonCalls(profile, rows, {
        ...options.games,
        seasonWindow: seasonWindow(client.planRules.current),
      });
      for (const p of planned) {
        const params = normalizeParams(p.params);
        if (quotaDenied) {
          calls.push({ endpoint: p.endpoint, params, source: 'deferred', detail: 'cota do dia esgotada' });
          continue;
        }
        try {
          const res = await client.get({ sport, endpoint: p.endpoint, params, priority: 'BOOTSTRAP', jobId });
          calls.push({ endpoint: p.endpoint, params, source: res.source });
        } catch (err) {
          if (err instanceof QuotaExceededError) {
            quotaDenied = true;
            calls.push({ endpoint: p.endpoint, params, source: 'deferred', detail: err.reason });
          } else if (err instanceof PlanViolationError) {
            calls.push({ endpoint: p.endpoint, params, source: 'skipped', detail: err.message });
          } else if (err instanceof ApiSportsError) {
            calls.push({ endpoint: p.endpoint, params, source: 'error', detail: err.outcome });
          } else throw err;
        }
      }
    }

    await db
      .update(jobRun)
      .set({
        status: 'ok',
        finishedAt: new Date(),
        callsSpent: spent(),
        stats: {
          ...stats,
          catalog: summarizeSport(check),
          deferred: calls.filter((c) => c.source === 'deferred').length,
        },
      })
      .where(eq(jobRun.id, run!.id));
    return { sport, calls, stats, check };
  } catch (err) {
    await db
      .update(jobRun)
      .set({ status: 'error', finishedAt: new Date(), callsSpent: spent(), error: String(err) })
      .where(eq(jobRun.id, run!.id));
    throw err;
  }
}

export function summarizeSport(check: SportCatalogCheck[]): Record<SportCatalogCheck['status'], number> {
  const out = { ok: 0, missing: 0, mismatch: 0, unverified: 0 };
  for (const c of check) out[c.status] += 1;
  return out;
}
