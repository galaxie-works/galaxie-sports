/**
 * Normalização a partir do raw (zero chamadas ao fornecedor): lê a resposta mais recente **bem-sucedida**
 * de cada requisição (`request_hash`) em `raw.api_response`, normaliza e grava no core.
 * Reprocessar tudo duas vezes gera o mesmo estado (issue #22).
 */
import { and, eq, sql } from 'drizzle-orm';
import { apiResponse, jobRun, syncCursor, type Database } from '@galaxie/db';
import {
  NORMALIZABLE_FOOTBALL_ENDPOINTS,
  normalizeFootballEnvelope,
  type EnvelopeLike,
} from '@galaxie/providers';
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

export async function normalizeFootballFromRaw(
  db: Database,
  options: NormalizeRawOptions = {},
): Promise<NormalizeRawResult> {
  const provider = options.provider ?? 'api-sports';
  const latest = await latestSuccessfulResponses(db, {
    provider,
    sport: 'football',
    endpoints: options.endpoints ?? NORMALIZABLE_FOOTBALL_ENDPOINTS,
    afterId: options.afterId ?? 0,
  });

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
      const normalized = normalizeFootballEnvelope(
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

const CURSOR = { endpoint: 'normalize:core', key: 'football' } as const;

/** Lê o cursor do modo incremental (`ops.sync_cursor`). */
export async function readNormalizeCursor(db: Database, provider = 'api-sports'): Promise<number> {
  const [row] = await db
    .select({ cursor: syncCursor.cursor })
    .from(syncCursor)
    .where(
      and(
        eq(syncCursor.provider, provider),
        eq(syncCursor.sport, 'football'),
        eq(syncCursor.endpoint, CURSOR.endpoint),
        eq(syncCursor.key, CURSOR.key),
      ),
    );
  const value = (row?.cursor as { lastRawId?: number } | null)?.lastRawId;
  return typeof value === 'number' ? value : 0;
}

export async function writeNormalizeCursor(
  db: Database,
  lastRawId: number,
  provider = 'api-sports',
): Promise<void> {
  await db
    .insert(syncCursor)
    .values({ provider, sport: 'football', ...CURSOR, cursor: { lastRawId }, completedAt: new Date() })
    .onConflictDoUpdate({
      target: [syncCursor.provider, syncCursor.sport, syncCursor.endpoint, syncCursor.key],
      set: { cursor: { lastRawId }, completedAt: new Date(), updatedAt: new Date() },
    });
}

export interface NormalizeJobOptions extends NormalizeRawOptions {
  /** Reprocessa todo o raw (ignora o cursor). */
  full?: boolean;
}

/** Job com registro em `ops.job_run` e cursor incremental em `ops.sync_cursor`. */
export async function runNormalizeFootballJob(
  db: Database,
  options: NormalizeJobOptions = {},
): Promise<NormalizeRawResult> {
  const provider = options.provider ?? 'api-sports';
  const [run] = await db.insert(jobRun).values({ job: 'normalize:football', status: 'running' }).returning();
  try {
    const afterId = options.full ? 0 : await readNormalizeCursor(db, provider);
    const result = await normalizeFootballFromRaw(db, { ...options, afterId });
    const errors = result.rows.filter((r) => r.outcome === 'error');
    // com erro, o cursor para antes da primeira resposta que falhou (será tentada de novo; o upsert é idempotente)
    const next = errors.length ? Math.min(...errors.map((e) => e.id)) - 1 : result.lastRawId;
    if (next != null) await writeNormalizeCursor(db, Math.max(afterId, next), provider);
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
      .where(eq(jobRun.id, run!.id));
    return result;
  } catch (err) {
    await db
      .update(jobRun)
      .set({ status: 'error', finishedAt: new Date(), error: String(err) })
      .where(eq(jobRun.id, run!.id));
    throw err;
  }
}
