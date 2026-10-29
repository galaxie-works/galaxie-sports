/**
 * Retenção das tabelas de operação que só crescem (lote 6 da auditoria de 28/10/2026). Cada tabela tem uma regra
 * explícita, documentada em docs/04 §1.1 e no painel (descrição do job `data-retention`):
 *
 * | tabela                  | guarda                                                                   |
 * |-------------------------|--------------------------------------------------------------------------|
 * | ops.llm_usage           | 90 dias por chamada; antes de apagar, o dia vira linha em llm_usage_daily  |
 * | ops.job_run             | 90 dias; a última execução e o último sucesso de cada job ficam sempre     |
 * | ops.quota_ledger        | 90 dias de cota (`day_utc`); o Governor só lê o dia corrente              |
 * | ops.job_request         | 30 dias depois de encerrado (pendente e em execução ficam)                 |
 * | ops.normalize_failure   | 90 dias depois de resolvida (pendente e poison ficam)                      |
 * | api.webhook_delivery    | entregue: 30 dias; DLQ (`dead`): 90 dias; pendente fica                    |
 *
 * O `ops.change_feed` tem job próprio (`change-feed-prune`, change-feed-retention.ts) e o `raw.api_response` está
 * em raw-retention.ts. Ficam para sempre, de propósito: `core.event_state_log` (a API pública mostra o histórico
 * de estados do jogo), `ops.runtime_setting_log`, `api.api_key_event` e `semantic.review_log` (auditoria),
 * `enrich.wtw_run` (o `run_key` é a trava que impede rodar de novo a mesma janela) e `enrich.related_run`
 * (pequenas: uma linha por jogo e janela). `ops.quality_*` já é podado pelo próprio job `data-quality`.
 *
 * Cada DELETE vai em lotes curtos (uma transação por lote), dentro do statement_timeout do perfil `job`.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export interface RetentionPolicy {
  table: string;
  /** Dias guardados (pela coluna de tempo da regra). */
  days: number;
  /** Regra em uma linha (relatório e docs). */
  rule: string;
}

export const OPS_RETENTION = {
  llmUsage: {
    table: 'ops.llm_usage',
    days: 90,
    rule: 'detalhe por chamada; o dia fica em ops.llm_usage_daily',
  },
  jobRun: { table: 'ops.job_run', days: 90, rule: 'mantém a última execução e o último sucesso de cada job' },
  quotaLedger: { table: 'ops.quota_ledger', days: 90, rule: 'por dia de cota (day_utc)' },
  jobRequest: { table: 'ops.job_request', days: 30, rule: 'só pedidos encerrados' },
  normalizeFailure: { table: 'ops.normalize_failure', days: 90, rule: 'só falhas resolvidas' },
  webhookDelivered: { table: 'api.webhook_delivery', days: 30, rule: 'entregues' },
  webhookDead: { table: 'api.webhook_delivery', days: 90, rule: 'DLQ (dead)' },
} as const satisfies Record<string, RetentionPolicy>;

export type OpsRetentionKey = keyof typeof OPS_RETENTION;

export interface OpsRetentionOptions {
  now?: Date;
  /** Linhas por DELETE. Padrão 5000. */
  batchSize?: number;
  pauseMs?: number;
  dryRun?: boolean;
  /** Troca os dias de alguma regra (testes, ou um CLI com --dias). */
  days?: Partial<Record<OpsRetentionKey, number>>;
}

export interface OpsRetentionRow {
  key: OpsRetentionKey;
  table: string;
  rule: string;
  cutoff: Date;
  /** Apagadas (ou que seriam, no `dryRun`). */
  deleted: number;
}

export interface OpsRetentionReport {
  rows: OpsRetentionRow[];
  /** Dias do ledger de IA agregados em ops.llm_usage_daily nesta execução. */
  llmDaysAggregated: number;
  dryRun: boolean;
}

/** Seleção de ids a apagar de uma tabela (uma subconsulta `select <pk> from ... where ...`). */
interface Target {
  key: OpsRetentionKey;
  table: string;
  pk: string;
  victims: (cutoff: Date) => SQL;
}

const iso = (d: Date) => sql`${d.toISOString()}::timestamptz`;

const TARGETS: Target[] = [
  {
    key: 'jobRun',
    table: 'ops.job_run',
    pk: 'id',
    victims: (cutoff) => sql`
      select j.id from ops.job_run j
       where j.started_at < ${iso(cutoff)}
         and j.id not in (select distinct on (job) id from ops.job_run order by job, started_at desc)
         and j.id not in (select distinct on (job) id from ops.job_run
                           where status in ('ok', 'budget_skipped') order by job, started_at desc)`,
  },
  {
    key: 'quotaLedger',
    table: 'ops.quota_ledger',
    pk: 'id',
    // o dia de cota inteiro sai de uma vez (índice quota_ledger_day_idx); pending velho é ticket perdido
    victims: (cutoff) => sql`
      select q.id from ops.quota_ledger q
       where q.day_utc < ${cutoff.toISOString().slice(0, 10)}::date`,
  },
  {
    key: 'jobRequest',
    table: 'ops.job_request',
    pk: 'id',
    victims: (cutoff) => sql`
      select r.id from ops.job_request r
       where r.status not in ('pending', 'running')
         and coalesce(r.finished_at, r.requested_at) < ${iso(cutoff)}`,
  },
  {
    key: 'webhookDelivered',
    table: 'api.webhook_delivery',
    pk: 'id',
    victims: (cutoff) => sql`
      select w.id from api.webhook_delivery w
       where w.status = 'delivered' and coalesce(w.delivered_at, w.created_at) < ${iso(cutoff)}`,
  },
  {
    key: 'webhookDead',
    table: 'api.webhook_delivery',
    pk: 'id',
    victims: (cutoff) => sql`
      select w.id from api.webhook_delivery w
       where w.status = 'dead' and coalesce(w.last_attempt_at, w.created_at) < ${iso(cutoff)}`,
  },
];

const cutoffOf = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/**
 * Agrega em ops.llm_usage_daily os dias de orçamento anteriores ao corte que ainda têm detalhe e apaga o detalhe
 * deles, um dia por transação: o agregado é recalculado do detalhe inteiro do dia (upsert que substitui), então
 * repetir depois de uma queda no meio não soma duas vezes.
 */
async function pruneLlmUsage(
  db: Database,
  cutoff: Date,
  dryRun: boolean,
): Promise<{ deleted: number; days: number }> {
  const day = cutoff.toISOString().slice(0, 10);
  if (dryRun) {
    const [row] = await db.execute<{ n: number; days: number }>(sql`
      select count(*)::int as n, count(distinct day_utc)::int as days
        from ops.llm_usage where day_utc < ${day}::date`);
    return { deleted: Number(row?.n ?? 0), days: Number(row?.days ?? 0) };
  }
  const days = await db.execute<{ day: string }>(sql`
    select distinct day_utc::text as day from ops.llm_usage where day_utc < ${day}::date order by 1`);
  let deleted = 0;
  for (const { day: d } of days) {
    deleted += await db.transaction(async (tx) => {
      await tx.execute(sql`delete from ops.llm_usage_daily where day_utc = ${d}::date`);
      await tx.execute(sql`
        insert into ops.llm_usage_daily (day_utc, budget_day, band, agent, provider, model, tier, outcome,
                                         calls, input_tokens, output_tokens, web_searches, cost_usd)
        select day_utc, coalesce(budget_day, day_utc), coalesce(band, ''), agent, provider, model, tier, outcome,
               count(*)::int, sum(input_tokens)::bigint, sum(output_tokens)::bigint, sum(web_searches)::int,
               sum(cost_usd)
          from ops.llm_usage where day_utc = ${d}::date
         group by 1, 2, 3, 4, 5, 6, 7, 8`);
      const rows = await tx.execute(sql`delete from ops.llm_usage where day_utc = ${d}::date returning 1`);
      return rows.length;
    });
  }
  return { deleted, days: days.length };
}

async function pruneNormalizeFailures(db: Database, cutoff: Date, batch: number, dryRun: boolean) {
  const victims = sql`
    select provider, sport, raw_id from ops.normalize_failure
     where resolved_at is not null and resolved_at < ${iso(cutoff)}`;
  if (dryRun) {
    const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from (${victims}) v`);
    return Number(row?.n ?? 0);
  }
  let total = 0;
  for (;;) {
    const rows = await db.execute(sql`
      delete from ops.normalize_failure f
       where (f.provider, f.sport, f.raw_id) in (${victims} limit ${batch})
      returning 1`);
    total += rows.length;
    if (rows.length < batch) return total;
  }
}

export async function pruneOpsTables(
  db: Database,
  options: OpsRetentionOptions = {},
): Promise<OpsRetentionReport> {
  const now = options.now ?? new Date();
  const batch = options.batchSize ?? 5000;
  const dryRun = options.dryRun ?? false;
  const daysOf = (key: OpsRetentionKey) => {
    const d = options.days?.[key] ?? OPS_RETENTION[key].days;
    if (!Number.isFinite(d) || d < 1)
      throw new Error(`Retenção de ${OPS_RETENTION[key].table} precisa ser ≥ 1 dia.`);
    return d;
  };
  const row = (key: OpsRetentionKey, cutoff: Date, deleted: number): OpsRetentionRow => ({
    key,
    table: OPS_RETENTION[key].table,
    rule: OPS_RETENTION[key].rule,
    cutoff,
    deleted,
  });
  const report: OpsRetentionReport = { rows: [], llmDaysAggregated: 0, dryRun };

  const llmCutoff = cutoffOf(now, daysOf('llmUsage'));
  const llm = await pruneLlmUsage(db, llmCutoff, dryRun);
  report.rows.push(row('llmUsage', llmCutoff, llm.deleted));
  report.llmDaysAggregated = dryRun ? 0 : llm.days;

  for (const t of TARGETS) {
    const cutoff = cutoffOf(now, daysOf(t.key));
    const victims = t.victims(cutoff);
    let deleted = 0;
    if (dryRun) {
      const [r] = await db.execute<{ n: number }>(sql`select count(*)::int as n from (${victims}) v`);
      deleted = Number(r?.n ?? 0);
    } else {
      for (;;) {
        const rows = await db.execute(sql`
          delete from ${sql.raw(t.table)} where ${sql.raw(t.pk)} in (${victims} limit ${batch}) returning 1`);
        deleted += rows.length;
        if (rows.length < batch) break;
        if (options.pauseMs !== 0) await sleep(options.pauseMs ?? 100);
      }
    }
    report.rows.push(row(t.key, cutoff, deleted));
  }

  const nfCutoff = cutoffOf(now, daysOf('normalizeFailure'));
  report.rows.push(
    row('normalizeFailure', nfCutoff, await pruneNormalizeFailures(db, nfCutoff, batch, dryRun)),
  );
  return report;
}
