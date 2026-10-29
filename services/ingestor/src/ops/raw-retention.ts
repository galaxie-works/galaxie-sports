/**
 * Retenção do `raw.api_response` (decisão de 28/10/2026, docs/04 §1.1):
 * - o que o ao vivo buscou (`retention = 'live'`, gravado pelo cliente da api-sports nas chamadas LIVE) fica
 *   RAW_LIVE_RETENTION_DAYS (30) dias, contados da última vez que o corpo chegou; a última resposta de sucesso
 *   de cada requisição nunca é apagada (o reprocessamento e o espelho continuam achando o estado final);
 * - todo o resto (`keep`: diário, catálogo, temporada, detalhe) fica para sempre.
 *
 * `pruneRawLive` roda todo dia no job `data-retention`, em lotes curtos (uma transação curta por lote, dentro do
 * statement_timeout do perfil `job`). `compactRawHistory` arruma uma vez o histórico gravado antes da dedupe:
 * classifica como `live` o que veio dos jobs do ao vivo e junta respostas repetidas em sequência numa linha só.
 * As duas são idempotentes: rodar de novo não apaga nada além do que a regra manda.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export const RAW_LIVE_RETENTION_DAYS = 30;

/** Jobs cujas respostas são do ao vivo (`ops.job_run.job`, gravado como `job-run:<id>` no `job_id` do raw). */
export const LIVE_JOBS = ['live:run', 'live:reconcile'] as const;

const SUCCESS = (alias: string) =>
  sql.raw(
    `(${alias}.status_code between 200 and 299 and (${alias}.errors is null or ${alias}.errors in ('[]'::jsonb, '{}'::jsonb)))`,
  );

export interface RawLiveRetentionOptions {
  /** Idade mínima (dias, pelo último "visto em"). Padrão 30. */
  retentionDays?: number;
  /** Linhas por DELETE. Padrão 500 (os corpos são grandes: o TOAST sai junto). */
  batchSize?: number;
  /** Pausa entre lotes (ms), para o autovacuum e a escrita do ao vivo respirarem. Padrão 200. */
  pauseMs?: number;
  /** Teto de lotes por execução (o resto fica para o dia seguinte). Padrão 2000. */
  maxBatches?: number;
  now?: Date;
  dryRun?: boolean;
}

export interface RawLiveRetentionReport {
  cutoff: Date;
  /** Linhas apagadas (ou que seriam, no `dryRun`). */
  deleted: number;
  /** Tamanho dos corpos apagados (bytes comprimidos, `pg_column_size`). */
  bodyBytes: number;
  dryRun: boolean;
}

/** Candidatas: ao vivo, velhas, e com uma resposta de sucesso mais nova da mesma requisição (ou elas mesmas com erro). */
function liveVictims(cutoff: Date) {
  return sql`
    select c.id, pg_column_size(c.body) as bytes
      from raw.api_response c
     where c.retention = 'live'
       and coalesce(c.last_seen_at, c.fetched_at) < ${cutoff.toISOString()}::timestamptz
       and (not ${SUCCESS('c')} or exists (
             select 1 from raw.api_response n
              where n.provider = c.provider and n.sport = c.sport and n.endpoint = c.endpoint
                and n.request_hash = c.request_hash and ${SUCCESS('n')}
                and (n.fetched_at, n.id) > (c.fetched_at, c.id)))`;
}

export async function pruneRawLive(
  db: Database,
  options: RawLiveRetentionOptions = {},
): Promise<RawLiveRetentionReport> {
  const days = options.retentionDays ?? RAW_LIVE_RETENTION_DAYS;
  if (!Number.isFinite(days) || days < 1)
    throw new Error('A retenção do raw do ao vivo precisa ser de ≥ 1 dia.');
  const batch = options.batchSize ?? 500;
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * 86_400_000);
  const report: RawLiveRetentionReport = {
    cutoff,
    deleted: 0,
    bodyBytes: 0,
    dryRun: options.dryRun ?? false,
  };
  if (report.dryRun) {
    const [row] = await db.execute<{ n: number; bytes: string | null }>(
      sql`select count(*)::int as n, sum(v.bytes)::text as bytes from (${liveVictims(cutoff)}) v`,
    );
    report.deleted = Number(row?.n ?? 0);
    report.bodyBytes = Number(row?.bytes ?? 0);
    return report;
  }
  for (let i = 0; i < (options.maxBatches ?? 2000); i++) {
    const [row] = await db.execute<{ n: number; bytes: string | null }>(sql`
      with v as (${liveVictims(cutoff)} order by coalesce(c.last_seen_at, c.fetched_at) limit ${batch}),
      d as (delete from raw.api_response r using v where r.id = v.id returning v.bytes)
      select count(*)::int as n, sum(bytes)::text as bytes from d`);
    const n = Number(row?.n ?? 0);
    report.deleted += n;
    report.bodyBytes += Number(row?.bytes ?? 0);
    if (n < batch) break;
    if (options.pauseMs !== 0) await sleep(options.pauseMs ?? 200);
  }
  return report;
}

export interface RawHistoryOptions {
  /** Requisições (request_hash) por transação na compactação. Padrão 200. */
  batchRequests?: number;
  /** Linhas por UPDATE na classificação. Padrão 5000. */
  classifyBatch?: number;
  pauseMs?: number;
  dryRun?: boolean;
}

export interface RawHistoryReport {
  /** Linhas `keep` que vieram dos jobs do ao vivo e passam a `live`. */
  classified: number;
  /** Linhas repetidas (mesmo corpo e status da anterior da requisição) juntadas na primeira da sequência. */
  merged: number;
  /** Tamanho dos corpos das linhas juntadas (bytes comprimidos). */
  mergedBodyBytes: number;
  dryRun: boolean;
}

/** Linhas do raw antigas que vieram dos jobs do ao vivo e ainda estão como `keep`. */
const unclassifiedLive = sql`
  select r.id from raw.api_response r
    join ops.job_run j on r.job_id = 'job-run:' || j.id::text
   where r.retention = 'keep' and r.job_id like 'job-run:%'
     and j.job in (${sql.join(
       LIVE_JOBS.map((j) => sql`${j}`),
       sql`, `,
     )})`;

/**
 * Sequências de corpo repetido por requisição: `head` é a primeira linha da sequência (fica), as outras saem.
 * Só pega requisições com mais de uma linha.
 */
function repeatedRuns(requestFilter: ReturnType<typeof sql>) {
  return sql`
    with o as (
      select id, provider, sport, endpoint, request_hash, fetched_at, last_seen_at, seen_count,
             pg_column_size(body) as bytes,
             case when lag(body_hash) over w = body_hash and lag(status_code) over w = status_code
                  then 0 else 1 end as brk
        from raw.api_response
       where ${requestFilter}
      window w as (partition by provider, sport, endpoint, request_hash order by fetched_at, id)
    ), g as (
      select o.*, sum(brk) over (partition by provider, sport, endpoint, request_hash
                                 order by fetched_at, id) as run
        from o
    ), runs as (
      select provider, sport, endpoint, request_hash, run,
             (array_agg(id order by fetched_at, id))[1] as head,
             max(coalesce(last_seen_at, fetched_at)) as seen,
             sum(seen_count)::int as seen_count,
             count(*) as rows
        from g group by 1, 2, 3, 4, 5 having count(*) > 1
    )
    select runs.head, runs.seen, runs.seen_count, g.id, g.bytes
      from runs
      join g using (provider, sport, endpoint, request_hash, run)
     where g.id <> runs.head`;
}

/**
 * Arruma o histórico gravado antes da dedupe, em etapas idempotentes: (1) classifica como `live` o que veio dos
 * jobs do ao vivo; (2) junta respostas repetidas em sequência numa linha só (a primeira, com o "visto em" e a
 * contagem somados). Não aplica a retenção: as linhas `live` velhas saem no `pruneRawLive` do dia.
 */
export async function compactRawHistory(
  db: Database,
  options: RawHistoryOptions = {},
): Promise<RawHistoryReport> {
  const report: RawHistoryReport = {
    classified: 0,
    merged: 0,
    mergedBodyBytes: 0,
    dryRun: options.dryRun ?? false,
  };
  const pause = () => (options.pauseMs === 0 ? Promise.resolve() : sleep(options.pauseMs ?? 200));

  if (report.dryRun) {
    const [c] = await db.execute<{ n: number }>(sql`select count(*)::int as n from (${unclassifiedLive}) v`);
    report.classified = Number(c?.n ?? 0);
    const [m] = await db.execute<{ n: number; bytes: string | null }>(sql`
      select count(*)::int as n, sum(bytes)::text as bytes from (${repeatedRuns(sql`true`)}) v`);
    report.merged = Number(m?.n ?? 0);
    report.mergedBodyBytes = Number(m?.bytes ?? 0);
    return report;
  }

  const classifyBatch = options.classifyBatch ?? 5000;
  for (;;) {
    const [row] = await db.execute<{ n: number }>(sql`
      with v as (${unclassifiedLive} limit ${classifyBatch}),
      u as (update raw.api_response r set retention = 'live' from v where r.id = v.id returning 1)
      select count(*)::int as n from u`);
    const n = Number(row?.n ?? 0);
    report.classified += n;
    if (n < classifyBatch) break;
    await pause();
  }

  // requisições com mais de uma linha, em ordem de request_hash (keyset): cada lote é uma transação curta
  const batchRequests = options.batchRequests ?? 200;
  let after = '';
  for (;;) {
    const reqs = await db.execute<{ request_hash: string }>(sql`
      select request_hash from raw.api_response
       where request_hash > ${after}
       group by request_hash having count(*) > 1
       order by request_hash limit ${batchRequests}`);
    if (!reqs.length) break;
    const hashes = reqs.map((r) => r.request_hash);
    after = hashes[hashes.length - 1]!;
    const filter = sql`request_hash in (${sql.join(
      hashes.map((h) => sql`${h}`),
      sql`, `,
    )})`;
    const [row] = await db.transaction(async (tx) => {
      // a cabeça de cada sequência herda o último "visto em" e a contagem; as repetidas saem
      return tx.execute<{ n: number; bytes: string | null }>(sql`
        with v as (${repeatedRuns(filter)}),
        h as (
          update raw.api_response r
             set last_seen_at = greatest(coalesce(r.last_seen_at, r.fetched_at), x.seen),
                 seen_count = x.seen_count
            from (select distinct head, seen, seen_count from v) x
           where r.id = x.head
          returning 1
        ),
        d as (delete from raw.api_response r using v where r.id = v.id returning v.bytes)
        select count(*)::int as n, sum(bytes)::text as bytes from d`);
    });
    report.merged += Number(row?.n ?? 0);
    report.mergedBodyBytes += Number(row?.bytes ?? 0);
    if (reqs.length < batchRequests) break;
    await pause();
  }
  return report;
}
