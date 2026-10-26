import {
  ApiSportsError,
  FOREVER,
  normalizeParams,
  PgRawStore,
  PlanViolationError,
  QuotaExceededError,
  requestHash,
  ttlFor,
  type ApiSportsClient,
  type Envelope,
  type PlanLimits,
  type RawScope,
} from '@galaxie/apisports-client';
import { jobRun, type Database } from '@galaxie/db';
import { eq } from 'drizzle-orm';
import type { SportCatalogCompetition } from '../catalog/catalog-config.js';
import { linkNbaLogos } from '../catalog/nba-logos.js';
import { upsertCatalog, type CatalogRows, type UpsertStats } from '../catalog/persist.js';
import {
  checkSportCatalog,
  estimateSeasonCalls,
  planSeasonCalls,
  SPORT_PROFILES,
  type OtherSport,
  type PlannedSeasonCall,
  type ReferenceResponses,
  type SeasonCall,
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
  /** Só estas temporadas (`--temporada`); vazio = todas as da janela. */
  seasons?: readonly number[];
  /** Também busca a classificação de cada temporada (padrão no CLI; `--sem-tabelas` desliga). */
  standings?: boolean;
}

function seasonWindow(plan: PlanLimits): { min: number; max: number } | undefined {
  return plan.seasons;
}

/**
 * Validade do raw numa chamada `final`: para sempre, salvo se a resposta guardada foi buscada antes de
 * `finalAfter` (o resultado ainda podia mudar, ex.: placar por quarto corrigido depois do jogo). Aí 0: busca
 * uma última vez, e a nova resposta passa a valer para sempre.
 */
async function finalMaxAge(
  store: PgRawStore,
  hash: string,
  scope: RawScope,
  call: SeasonCall,
  now: Date,
): Promise<number> {
  if (call.finalAfter === undefined) return FOREVER;
  const cached = await store.findFresh(hash, FOREVER, now, scope);
  return cached && cached.fetchedAt.getTime() < call.finalAfter ? 0 : FOREVER;
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
    const scope = { provider: 'api-sports', sport, endpoint };
    const fresh = await store.findFresh(hash, ttlFor(endpoint, {}, now), now, scope);
    calls.push({ endpoint, source: fresh ? 'cache' : 'network' });
    const any = fresh ?? (await store.findFresh(hash, Number.POSITIVE_INFINITY, now, scope));
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
    const closedBefore = now.getUTCFullYear() - 1;
    // os detalhes entram no fim da fila: depois de todas as temporadas e tabelas
    const queue: SeasonCall[] = [...planned];
    for (let i = 0; i < queue.length; i++) {
      const p = queue[i]!;
      const params = normalizeParams(p.params);
      const hash = requestHash('api-sports', sport, p.endpoint, params);
      const final = p.final ?? (i < planned.length && planned[i]!.season < closedBefore);
      const scope = { provider: 'api-sports', sport, endpoint: p.endpoint };
      const maxAge = final ? await finalMaxAge(store, hash, scope, p, now) : ttlFor(p.endpoint, params, now);
      const fresh = maxAge > 0 ? await store.findFresh(hash, maxAge, now, scope) : undefined;
      calls.push({ endpoint: p.endpoint, params, source: fresh ? 'cache' : 'network' });
      // os detalhes (F1: uma chamada por sessão) só aparecem quando a temporada já está no raw
      const any = fresh ?? (await store.findFresh(hash, Number.POSITIVE_INFINITY, now, scope));
      if (any && i < planned.length && planned[i]!.kind === 'season' && profile.detailCalls)
        queue.push(...profile.detailCalls((any.body as Envelope).response, now));
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
 * Com `games`, busca também a temporada inteira das competições prioritárias e, com `games.standings`, a
 * classificação de cada temporada (só para o raw; `normalize:sports` leva jogos e tabelas ao core).
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
    // o catálogo regrava logo_asset_id: os logos da NBA v2 voltam do api-basketball
    if (sport === 'nba') await linkNbaLogos(db);
    const check = checkSportCatalog(catalog, rows);

    if (options.games) {
      const planned = planSeasonCalls(profile, rows, {
        ...options.games,
        seasonWindow: seasonWindow(client.planRulesFor(sport).current),
      });
      // temporada encerrada não muda: o que já está no raw vale (retomar no dia seguinte não gasta de novo)
      const closedBefore = now.getUTCFullYear() - 1;
      // os detalhes (F1: uma chamada por sessão) entram no fim da fila: depois de todas as temporadas e tabelas
      const queue: SeasonCall[] = planned.map((p) => ({ ...p, final: p.final ?? p.season < closedBefore }));
      const store = new PgRawStore(db);
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i]!;
        const params = normalizeParams(p.params);
        if (quotaDenied) {
          calls.push({ endpoint: p.endpoint, params, source: 'deferred', detail: 'cota do dia esgotada' });
          continue;
        }
        try {
          const res = await client.get({
            sport,
            endpoint: p.endpoint,
            params,
            priority: 'BOOTSTRAP',
            jobId,
            ...(p.final
              ? {
                  maxAgeMs: await finalMaxAge(
                    store,
                    requestHash('api-sports', sport, p.endpoint, params),
                    { provider: 'api-sports', sport, endpoint: p.endpoint },
                    p,
                    now,
                  ),
                }
              : {}),
          });
          calls.push({ endpoint: p.endpoint, params, source: res.source });
          if (i < planned.length && planned[i]!.kind === 'season' && profile.detailCalls)
            queue.push(...profile.detailCalls(res.envelope.response, now));
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
