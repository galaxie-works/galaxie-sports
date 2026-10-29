/**
 * Retenção do `ops.change_feed` (follow-up do #35): apaga mudanças com mais de N dias, mas mantém a
 * mais recente de cada entidade (`entity_type`, `entity_id`) — quem consulta "a última mudança de X"
 * continua achando — e nunca apaga o que um consumidor com cursor ainda não leu: o enfileirador de webhooks
 * (`api.webhook_cursor`, sempre) e o piso do GapCursor do cache da demo (`demo_auth.cache_feed_cursor`, enquanto
 * a demo ainda retomaria dele: atualizado nas últimas DEMO_CURSOR_RESUME_HOURS). O SSE só retoma pelo
 * `Last-Event-ID` dentro da janela de retenção: o maior id
 * apagado fica em `ops.change_feed_prune`, e quem retoma de antes dele recebe `replay_truncated`.
 * Apaga em lotes curtos para não segurar locks; rode uma vez por dia (job `change-feed-prune`).
 */
import { sql } from 'drizzle-orm';
import type { Database } from '@galaxie/db';

export const DEFAULT_CHANGE_FEED_RETENTION_DAYS = 7;

/** O cache da demo só retoma de um cursor salvo há até 24 h (`resumeMaxAgeMs` em apps/demo/src/lib/cache/follower.ts). */
export const DEMO_CURSOR_RESUME_HOURS = 24;

export interface ChangeFeedRetentionOptions {
  /** Idade mínima (dias) para apagar. Padrão 7. */
  retentionDays?: number;
  /** Linhas por DELETE. Padrão 5000. */
  batchSize?: number;
  now?: Date;
  /** Só conta o que seria apagado. */
  dryRun?: boolean;
}

export interface ChangeFeedRetentionReport {
  cutoff: Date;
  /** Apagadas (ou que seriam apagadas, no `dryRun`). */
  deleted: number;
  /**
   * Menor piso entre os consumidores com cursor (webhooks e cache da demo): limite superior do que pode ser
   * apagado; null = sem consumidor.
   */
  webhookCursor: number | null;
  dryRun: boolean;
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Grava (sem regredir) o maior id já apagado em `ops.change_feed_prune`. */
export async function markPruned(tx: Database | Tx, maxDeletedId: number): Promise<void> {
  await tx.execute(sql`
    insert into ops.change_feed_prune (name, max_deleted_id) values ('default', ${maxDeletedId})
    on conflict (name) do update
      set max_deleted_id = greatest(ops.change_feed_prune.max_deleted_id, excluded.max_deleted_id),
          updated_at = now()`);
}

export async function pruneChangeFeed(
  db: Database,
  options: ChangeFeedRetentionOptions = {},
): Promise<ChangeFeedRetentionReport> {
  const days = options.retentionDays ?? DEFAULT_CHANGE_FEED_RETENTION_DAYS;
  if (!Number.isFinite(days) || days < 1)
    throw new Error('A retenção do change feed precisa ser de ≥ 1 dia.');
  const batch = options.batchSize ?? 5000;
  const cutoff = new Date((options.now ?? new Date()).getTime() - days * 86_400_000);
  const [demo] = await db.execute<{ ok: boolean }>(
    sql`select to_regclass('demo_auth.cache_feed_cursor') is not null as ok`,
  );
  const [cur] = await db.execute<{ id: string | null }>(sql`
    select min(id)::text as id from (
      select last_change_id as id from api.webhook_cursor
      ${
        demo?.ok
          ? sql`union all
      select last_change_id from demo_auth.cache_feed_cursor
       where updated_at > now() - make_interval(hours => ${DEMO_CURSOR_RESUME_HOURS}::int)`
          : sql``
      }
    ) c`);
  const webhookCursor = cur?.id == null ? null : Number(cur.id);
  const report: ChangeFeedRetentionReport = {
    cutoff,
    deleted: 0,
    webhookCursor,
    dryRun: options.dryRun ?? false,
  };
  const victims = sql`
    select cf.id from ops.change_feed cf
     where cf.created_at < ${cutoff.toISOString()}::timestamptz
       ${webhookCursor === null ? sql`` : sql`and cf.id <= ${webhookCursor}`}
       and cf.id not in (select max(l.id) from ops.change_feed l group by l.entity_type, l.entity_id)`;

  if (report.dryRun) {
    const [row] = await db.execute<{ n: number }>(sql`select count(*)::int as n from (${victims}) v`);
    report.deleted = Number(row?.n ?? 0);
    return report;
  }
  for (;;) {
    // marca da poda (o SSE avisa replay_truncated a quem retoma de um Last-Event-ID abaixo dela) na mesma
    // transação de cada lote: se o processo cair entre lotes, nada some sem a marca cobrir
    const deleted = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string }>(sql`
        delete from ops.change_feed
         where id in (${victims} order by cf.id limit ${batch})
         returning id`);
      const max = rows.reduce((m, r) => Math.max(m, Number(r.id)), 0);
      if (max > 0) await markPruned(tx, max);
      return rows.length;
    });
    report.deleted += deleted;
    if (deleted < batch) break;
  }
  return report;
}
