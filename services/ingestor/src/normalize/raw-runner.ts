/**
 * Normalização a partir do raw (zero chamadas ao fornecedor): lê a resposta mais recente **bem-sucedida**
 * de cada requisição (`request_hash`) em `raw.api_response`, normaliza e grava no core.
 * Reprocessar tudo duas vezes gera o mesmo estado (issues #22 e #25).
 */
import { and, eq, sql } from 'drizzle-orm';
import { apiResponse, jobRun, sport as sportTable, syncCursor, type Database } from '@galaxie/db';
import {
  API_SPORTS_OTHER_SPORTS,
  NORMALIZABLE_FOOTBALL_ENDPOINTS,
  NORMALIZABLE_SPORT_ENDPOINTS,
  normalizeFootballEnvelope,
  normalizeSportEnvelope,
  SPORT_SUPPLEMENT_ENDPOINTS,
  type ApiSportsOtherSport,
  type EnvelopeLike,
  type NormalizedBatch,
} from '@galaxie/providers';
import { linkNbaLogos } from '../catalog/nba-logos.js';
import { SPORTS } from '../catalog/persist.js';
import { recomputeNbaStandings } from '../standings/nba.js';
import { addStats, emptyStats, upsertBatch, type UpsertOptions, type UpsertStats } from './upsert-core.js';

export interface NormalizeRawOptions extends UpsertOptions {
  provider?: string;
  /** Processa só respostas com `id` maior que este (modo incremental). */
  afterId?: number;
  endpoints?: readonly string[];
  /** Chamado a cada resposta processada (progresso no CLI). */
  onRow?: (row: RawRowReport) => void;
}

export interface RawRowReport {
  id: number;
  endpoint: string;
  params: Record<string, string | number>;
  outcome: 'ok' | 'empty' | 'unsupported' | 'error';
  items: number;
  error?: string;
}

export interface NormalizeRawResult {
  rows: RawRowReport[];
  stats: UpsertStats;
  /** Maior `id` do raw examinado (cursor do modo incremental). */
  lastRawId: number | null;
}

type LatestRow = {
  id: number;
  endpoint: string;
  params: Record<string, string | number>;
  fetched_at: Date | string;
};

/** Última resposta bem-sucedida por `request_hash`, em ordem de coleta. */
export async function latestSuccessfulResponses(
  db: Database,
  options: { provider: string; sport: string; endpoints: readonly string[]; afterId: number },
): Promise<LatestRow[]> {
  return db.execute<LatestRow>(sql`
    select id, endpoint, params, fetched_at from (
      select distinct on (request_hash) id, endpoint, params, fetched_at
      from ${apiResponse}
      where provider = ${options.provider}
        and sport = ${options.sport}
        and endpoint in (${sql.join(
          options.endpoints.map((e) => sql`${e}`),
          sql`, `,
        )})
        and status_code between 200 and 299
        and (errors is null or errors in ('[]'::jsonb, '{}'::jsonb))
      order by request_hash, fetched_at desc, id desc
    ) latest
    where id > ${options.afterId}
    order by fetched_at asc, id asc`);
}

/** Normalizador de envelope de um esporte (puro, de `@galaxie/providers`). */
type EnvelopeNormalizer = (
  endpoint: string,
  envelope: EnvelopeLike,
  observedAt: Date,
  params: Record<string, string>,
) => { batch: NormalizedBatch; items: number } | null;

/**
 * Lê do raw a última resposta bem-sucedida de cada requisição do esporte, normaliza e grava no core.
 * `rank` ordena as respostas antes do processamento (estável pela ordem de coleta): os complementos
 * (resultados, grid) vêm depois das listas que criam os eventos.
 */
async function normalizeFromRaw(
  db: Database,
  sport: string,
  normalize: EnvelopeNormalizer,
  endpoints: readonly string[],
  options: NormalizeRawOptions,
  rank: (endpoint: string) => number = () => 0,
): Promise<NormalizeRawResult> {
  const provider = options.provider ?? 'api-sports';
  const latest = (
    await latestSuccessfulResponses(db, {
      provider,
      sport,
      endpoints: options.endpoints ?? endpoints,
      afterId: options.afterId ?? 0,
    })
  )
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank(a.row.endpoint) - rank(b.row.endpoint) || a.i - b.i)
    .map(({ row }) => row);

  const rows: RawRowReport[] = [];
  let stats = emptyStats();
  let lastRawId: number | null = null;
  for (const row of latest) {
    lastRawId = Math.max(lastRawId ?? 0, Number(row.id));
    const [raw] = await db
      .select({ body: apiResponse.body })
      .from(apiResponse)
      .where(eq(apiResponse.id, Number(row.id)));
    const params = Object.fromEntries(Object.entries(row.params ?? {}).map(([k, v]) => [k, String(v)]));
    const report: RawRowReport = {
      id: Number(row.id),
      endpoint: row.endpoint,
      params: row.params,
      outcome: 'ok',
      items: 0,
    };
    try {
      const normalized = normalize(
        row.endpoint,
        (raw?.body ?? { response: [] }) as EnvelopeLike,
        new Date(row.fetched_at),
        params,
      );
      if (!normalized) report.outcome = 'unsupported';
      else {
        report.items = normalized.items;
        // resposta vazia não é dado novo: mantém o último estado válido
        if (normalized.items === 0) report.outcome = 'empty';
        else stats = addStats(stats, await upsertBatch(db, normalized.batch, options));
      }
    } catch (err) {
      report.outcome = 'error';
      report.error = err instanceof Error ? err.message : String(err);
    }
    rows.push(report);
    options.onRow?.(report);
  }
  return { rows, stats, lastRawId };
}

export async function normalizeFootballFromRaw(
  db: Database,
  options: NormalizeRawOptions = {},
): Promise<NormalizeRawResult> {
  return normalizeFromRaw(
    db,
    'football',
    normalizeFootballEnvelope,
    NORMALIZABLE_FOOTBALL_ENDPOINTS,
    options,
  );
}

/** Normalização raw → core de um dos 11 esportes além do futebol (issue #25). */
export async function normalizeSportFromRaw(
  db: Database,
  sport: ApiSportsOtherSport,
  options: NormalizeRawOptions = {},
): Promise<NormalizeRawResult> {
  return normalizeFromRaw(
    db,
    sport,
    (endpoint, envelope, observedAt, params) =>
      normalizeSportEnvelope(sport, endpoint, envelope, observedAt, params),
    NORMALIZABLE_SPORT_ENDPOINTS[sport],
    options,
    (endpoint) => (SPORT_SUPPLEMENT_ENDPOINTS.has(endpoint) ? 1 : 0),
  );
}

const CURSOR_ENDPOINT = 'normalize:core';

/** Lê o cursor do modo incremental (`ops.sync_cursor`, um por esporte). */
export async function readNormalizeCursor(
  db: Database,
  provider = 'api-sports',
  sport = 'football',
): Promise<number> {
  const [row] = await db
    .select({ cursor: syncCursor.cursor })
    .from(syncCursor)
    .where(
      and(
        eq(syncCursor.provider, provider),
        eq(syncCursor.sport, sport),
        eq(syncCursor.endpoint, CURSOR_ENDPOINT),
        eq(syncCursor.key, sport),
      ),
    );
  const value = (row?.cursor as { lastRawId?: number } | null)?.lastRawId;
  return typeof value === 'number' ? value : 0;
}

export async function writeNormalizeCursor(
  db: Database,
  lastRawId: number,
  provider = 'api-sports',
  sport = 'football',
): Promise<void> {
  await db
    .insert(syncCursor)
    .values({
      provider,
      sport,
      endpoint: CURSOR_ENDPOINT,
      key: sport,
      cursor: { lastRawId },
      completedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
      set: { cursor: { lastRawId }, completedAt: new Date(), updatedAt: new Date() },
    });
}

export interface NormalizeJobOptions extends NormalizeRawOptions {
  /** Reprocessa todo o raw (ignora o cursor). */
  full?: boolean;
}

/** Job com registro em `ops.job_run` (`normalize:<esporte>`) e cursor incremental em `ops.sync_cursor`. */
async function runNormalizeJob(
  db: Database,
  sport: string,
  run: (options: NormalizeRawOptions) => Promise<NormalizeRawResult>,
  options: NormalizeJobOptions,
): Promise<NormalizeRawResult> {
  const provider = options.provider ?? 'api-sports';
  const [job] = await db
    .insert(jobRun)
    .values({ job: `normalize:${sport}`, status: 'running' })
    .returning();
  try {
    const afterId = options.full ? 0 : await readNormalizeCursor(db, provider, sport);
    const result = await run({ ...options, afterId });
    const errors = result.rows.filter((r) => r.outcome === 'error');
    // com erro, o cursor para antes da primeira resposta que falhou (será tentada de novo; o upsert é idempotente)
    const next = errors.length ? Math.min(...errors.map((e) => e.id)) - 1 : result.lastRawId;
    // com filtro de endpoints o cursor não anda: pularia respostas dos outros endpoints
    if (next != null && !options.endpoints)
      await writeNormalizeCursor(db, Math.max(afterId, next), provider, sport);
    await db
      .update(jobRun)
      .set({
        status: errors.length ? 'partial' : 'ok',
        finishedAt: new Date(),
        stats: { ...result.stats, rows: result.rows.length, errors: errors.length, full: !!options.full },
        error: errors.length
          ? errors
              .map((e) => `raw ${e.id}: ${e.error}`)
              .join('\n')
              .slice(0, 4000)
          : null,
      })
      .where(eq(jobRun.id, job!.id));
    return result;
  } catch (err) {
    await db
      .update(jobRun)
      .set({ status: 'error', finishedAt: new Date(), error: String(err) })
      .where(eq(jobRun.id, job!.id));
    throw err;
  }
}

/** Job `normalize:football` com registro em `ops.job_run` e cursor incremental em `ops.sync_cursor`. */
export async function runNormalizeFootballJob(
  db: Database,
  options: NormalizeJobOptions = {},
): Promise<NormalizeRawResult> {
  return runNormalizeJob(db, 'football', (o) => normalizeFootballFromRaw(db, o), options);
}

export interface NormalizeSportsJobOptions extends NormalizeJobOptions {
  /** Esportes a normalizar (padrão: os 11 além do futebol). */
  sports?: readonly ApiSportsOtherSport[];
}

/**
 * `normalize:sports`: um job por esporte (`normalize:<esporte>`, cursor próprio em `ops.sync_cursor`).
 * Os esportes rodam em sequência; o upsert trava por provedor/esporte.
 */
export async function runNormalizeSportsJob(
  db: Database,
  options: NormalizeSportsJobOptions = {},
): Promise<{ sport: ApiSportsOtherSport; result: NormalizeRawResult }[]> {
  // o core exige o esporte cadastrado (o bootstrap do catálogo já faz isso; aqui é só garantia)
  await db.insert(sportTable).values(SPORTS).onConflictDoNothing();
  const out: { sport: ApiSportsOtherSport; result: NormalizeRawResult }[] = [];
  for (const sport of options.sports ?? API_SPORTS_OTHER_SPORTS) {
    const result = await runNormalizeJob(db, sport, (o) => normalizeSportFromRaw(db, sport, o), options);
    // NBA: a tabela do fornecedor vem defasada (a dos jogos a substitui) e os logos vêm do api-basketball
    if (sport === 'nba' && result.rows.length) {
      await recomputeNbaStandings(db);
      await linkNbaLogos(db);
    }
    out.push({ sport, result });
  }
  return out;
}
