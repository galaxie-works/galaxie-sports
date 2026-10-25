/**
 * Normalização a partir do raw (zero chamadas ao fornecedor): lê a resposta mais recente **bem-sucedida**
 * de cada requisição (`request_hash`) em `raw.api_response`, normaliza e grava no core.
 * Reprocessar tudo duas vezes gera o mesmo estado (issues #22 e #25).
 */
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  apiResponse,
  jobRun,
  normalizeFailure,
  sport as sportTable,
  syncCursor,
  type Database,
} from '@galaxie/db';
import {
  API_SPORTS_OTHER_SPORTS,
  NORMALIZABLE_FOOTBALL_ENDPOINTS,
  NORMALIZABLE_SPORT_ENDPOINTS,
  normalizeFootballEnvelope,
  normalizeSportEnvelope,
  seasonTeamsFromGames,
  SPORT_SUPPLEMENT_ENDPOINTS,
  type ApiSportsOtherSport,
  type EnvelopeLike,
  type NormalizedBatch,
  type SportStandingsContext,
} from '@galaxie/providers';
import { linkNbaLogos } from '../catalog/nba-logos.js';
import { SPORTS } from '../catalog/persist.js';
import { logger } from '../logger.js';
import { recomputeNbaStandings } from '../standings/nba.js';
import { addStats, emptyStats, upsertBatch, type UpsertOptions, type UpsertStats } from './upsert-core.js';

export interface NormalizeRawOptions extends UpsertOptions {
  provider?: string;
  /** Processa só respostas com `id` maior que este (modo incremental). */
  afterId?: number;
  /** Também estas respostas, mesmo abaixo do cursor (falhas pendentes, `--reprocessar-falhas`). */
  includeIds?: readonly number[];
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
  options: {
    provider: string;
    sport: string;
    endpoints: readonly string[];
    afterId: number;
    includeIds?: readonly number[] | undefined;
  },
): Promise<LatestRow[]> {
  const include = options.includeIds?.length
    ? sql` or id in (${sql.join(
        options.includeIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``;
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
    where id > ${options.afterId}${include}
    order by fetched_at asc, id asc`);
}

/** Normalizador de envelope de um esporte (puro, de `@galaxie/providers`). */
type EnvelopeNormalizer = (
  endpoint: string,
  envelope: EnvelopeLike,
  observedAt: Date,
  params: Record<string, string>,
) =>
  | { batch: NormalizedBatch; items: number }
  | null
  | Promise<{ batch: NormalizedBatch; items: number } | null>;

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
      includeIds: options.includeIds,
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
      const normalized = await normalize(
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
    async (endpoint, envelope, observedAt, params) =>
      normalizeSportEnvelope(
        sport,
        endpoint,
        envelope,
        observedAt,
        params,
        endpoint === '/standings' ? await standingsContext(db, sport, params) : {},
      ),
    NORMALIZABLE_SPORT_ENDPOINTS[sport],
    options,
    (endpoint) => (SPORT_SUPPLEMENT_ENDPOINTS.has(endpoint) ? 1 : 0),
  );
}

/**
 * Times dos jogos da mesma liga e temporada no raw, para a tabela recuperar o time que o fornecedor manda
 * como placeholder (`id: 0`): o Utah Mammoth na NHL 2024/25.
 */
export async function standingsContext(
  db: Database,
  sport: string,
  params: Record<string, string>,
): Promise<SportStandingsContext> {
  if (!params.league || !params.season) return {};
  const [games] = await db
    .select({ body: apiResponse.body })
    .from(apiResponse)
    .where(
      and(
        eq(apiResponse.provider, 'api-sports'),
        eq(apiResponse.sport, sport),
        eq(apiResponse.endpoint, '/games'),
        sql`${apiResponse.params}->>'league' = ${params.league}`,
        sql`${apiResponse.params}->>'season' = ${params.season}`,
        sql`${apiResponse.statusCode} between 200 and 299`,
        // envelope 200 com `errors` (cota, plano) ou sem jogos não vale: venceria o válido e a tabela perderia
        // os times recuperados (mesmo critério de latestSuccessfulResponses)
        sql`(${apiResponse.errors} is null or ${apiResponse.errors} in ('[]'::jsonb, '{}'::jsonb))`,
        sql`(case when jsonb_typeof(${apiResponse.body}->'response') = 'array'
                  then jsonb_array_length(${apiResponse.body}->'response') > 0 else false end)`,
      ),
    )
    .orderBy(sql`${apiResponse.fetchedAt} desc`, sql`${apiResponse.id} desc`)
    .limit(1);
  const response = (games?.body as { response?: unknown } | undefined)?.response;
  return Array.isArray(response) ? { teamsByName: seasonTeamsFromGames(response) } : {};
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
  /** Tenta de novo as respostas com falha pendente em `ops.normalize_failure`, mesmo abaixo do cursor. */
  retryFailures?: boolean;
}

/**
 * Falhas seguidas na mesma resposta do raw até ela virar poison: o erro é determinístico (normalizador ou dado
 * do fornecedor) e segurar o cursor nela faria todo normalize reprocessar tudo acima, para sempre.
 */
export const NORMALIZE_POISON_ATTEMPTS = 3;

/** Falhas pendentes (sem `resolved_at`) de um esporte, poison ou não. */
export async function pendingNormalizeFailures(
  db: Database,
  provider: string,
  sport: string,
): Promise<(typeof normalizeFailure.$inferSelect)[]> {
  return db
    .select()
    .from(normalizeFailure)
    .where(
      and(
        eq(normalizeFailure.provider, provider),
        eq(normalizeFailure.sport, sport),
        isNull(normalizeFailure.resolvedAt),
      ),
    )
    .orderBy(asc(normalizeFailure.rawId));
}

/**
 * Registra o desfecho da execução em `ops.normalize_failure`: cada erro soma uma tentativa (e vira poison na
 * N-ésima); resposta que passou ou que não voltou mais (`retried` sem linha: a requisição tem resposta mais
 * nova no raw) fica resolvida. Devolve os ids em poison, que não seguram o cursor.
 */
async function recordNormalizeFailures(
  db: Database,
  provider: string,
  sport: string,
  rows: readonly RawRowReport[],
  retried: readonly number[],
): Promise<Set<number>> {
  const errors = rows.filter((r) => r.outcome === 'error');
  const poisoned = new Set<number>();
  const attempts = sql`${normalizeFailure.attempts} + 1`;
  for (let i = 0; i < errors.length; i += 500) {
    const written = await db
      .insert(normalizeFailure)
      .values(
        errors.slice(i, i + 500).map((e) => ({
          provider,
          sport,
          rawId: e.id,
          endpoint: e.endpoint,
          error: e.error ?? null,
        })),
      )
      .onConflictDoUpdate({
        target: [normalizeFailure.provider, normalizeFailure.sport, normalizeFailure.rawId],
        set: {
          attempts,
          error: sql`excluded.error`,
          lastFailedAt: sql`now()`,
          poisonedAt: sql`case when ${attempts} >= ${NORMALIZE_POISON_ATTEMPTS}
            then coalesce(${normalizeFailure.poisonedAt}, now()) else ${normalizeFailure.poisonedAt} end`,
          resolvedAt: sql`null`,
        },
      })
      .returning({
        rawId: normalizeFailure.rawId,
        endpoint: normalizeFailure.endpoint,
        attempts: normalizeFailure.attempts,
        error: normalizeFailure.error,
        poisonedAt: normalizeFailure.poisonedAt,
      });
    for (const f of written) {
      if (!f.poisonedAt) continue;
      poisoned.add(Number(f.rawId));
      logger.warn(
        {
          sport,
          provider,
          raw_id: Number(f.rawId),
          endpoint: f.endpoint,
          attempts: f.attempts,
          error: f.error,
        },
        'resposta do raw em poison: o cursor da normalização segue sem ela (ops.normalize_failure)',
      );
    }
  }
  // pendentes são poucas: o cruzamento com as linhas da execução (que podem ser milhares) fica em memória
  const failed = new Set(errors.map((e) => e.id));
  const seen = new Set(rows.map((r) => r.id));
  const retriedSet = new Set(retried);
  const resolved = (await pendingNormalizeFailures(db, provider, sport))
    .map((f) => Number(f.rawId))
    .filter((id) => !failed.has(id) && (seen.has(id) || retriedSet.has(id)));
  if (resolved.length)
    await db
      .update(normalizeFailure)
      .set({ resolvedAt: sql`now()` })
      .where(
        and(
          eq(normalizeFailure.provider, provider),
          eq(normalizeFailure.sport, sport),
          inArray(normalizeFailure.rawId, resolved),
          isNull(normalizeFailure.resolvedAt),
        ),
      );
  return poisoned;
}

/**
 * Job com registro em `ops.job_run` (`normalize:<esporte>`) e cursor incremental em `ops.sync_cursor`.
 * `afterRun` (pós-processamento do esporte) roda antes de o cursor andar: se falhar, a próxima execução
 * reprocessa as mesmas respostas e tenta de novo.
 */
async function runNormalizeJob(
  db: Database,
  sport: string,
  run: (options: NormalizeRawOptions) => Promise<NormalizeRawResult>,
  options: NormalizeJobOptions,
  afterRun?: (result: NormalizeRawResult) => Promise<void>,
): Promise<NormalizeRawResult> {
  const provider = options.provider ?? 'api-sports';
  const [job] = await db
    .insert(jobRun)
    .values({ job: `normalize:${sport}`, status: 'running' })
    .returning();
  try {
    const afterId = options.full ? 0 : await readNormalizeCursor(db, provider, sport);
    const retried = options.retryFailures
      ? (await pendingNormalizeFailures(db, provider, sport)).map((f) => Number(f.rawId))
      : [];
    const result = await run({ ...options, afterId, ...(retried.length ? { includeIds: retried } : {}) });
    const errors = result.rows.filter((r) => r.outcome === 'error');
    const poisoned = await recordNormalizeFailures(db, provider, sport, result.rows, retried);
    // com erro, o cursor para antes da primeira resposta que falhou (será tentada de novo; o upsert é idempotente);
    // a que já falhou NORMALIZE_POISON_ATTEMPTS vezes não segura mais o cursor
    const blocking = errors.filter((e) => !poisoned.has(e.id));
    const next = blocking.length ? Math.min(...blocking.map((e) => e.id)) - 1 : result.lastRawId;
    if (afterRun) await afterRun(result);
    // com filtro de endpoints o cursor não anda: pularia respostas dos outros endpoints
    if (next != null && !options.endpoints)
      await writeNormalizeCursor(db, Math.max(afterId, next), provider, sport);
    await db
      .update(jobRun)
      .set({
        status: errors.length ? 'partial' : 'ok',
        finishedAt: new Date(),
        stats: {
          ...result.stats,
          rows: result.rows.length,
          errors: errors.length,
          poisoned: poisoned.size,
          retried: retried.length,
          full: !!options.full,
        },
        error: errors.length
          ? errors
              .map((e) => `raw ${e.id}${poisoned.has(e.id) ? ' (poison)' : ''}: ${e.error}`)
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
    // NBA: a tabela do fornecedor vem defasada (a dos jogos a substitui) e os logos vêm do api-basketball;
    // dentro do job, antes do cursor andar: se falhar, a próxima execução tenta de novo
    const afterRun =
      sport === 'nba'
        ? async (result: NormalizeRawResult) => {
            if (!result.rows.length) return;
            await recomputeNbaStandings(db);
            await linkNbaLogos(db);
          }
        : undefined;
    const result = await runNormalizeJob(
      db,
      sport,
      (o) => normalizeSportFromRaw(db, sport, o),
      options,
      afterRun,
    );
    out.push({ sport, result });
  }
  return out;
}
