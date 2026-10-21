/**
 * Recalcula clássico (`core.event.derby_id`) e importância dos eventos já gravados (issue #39).
 *
 * O upsert da normalização já grava os dois na escrita (busca de clássico na base semântica); este
 * recálculo serve para o que foi gravado antes do seed semântico ou de uma mudança na base (clássico
 * novo, intensidade revista, time ligado ao core depois). Mesma fórmula do upsert: tier da competição +
 * fase + clássico × intensidade (`importance` de `@galaxie/providers`). Idempotente: só toca a linha
 * cuja importância/clássico mudou e publica o purge de cache dessas linhas no change feed.
 */
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { publishChange, type Database } from '@galaxie/db';
import { assignEventDerbies } from '@galaxie/knowledge';
import { importance, type StageKind } from '@galaxie/providers';
import { chunks } from './sql-helpers.js';

export interface RecomputeImportanceOptions {
  /** Só eventos deste esporte. */
  sport?: string;
  /** Só eventos com início a partir deste instante. */
  since?: Date;
  /** Só estes eventos. */
  eventIds?: readonly string[];
  /** Calcula sem gravar (relatório do que mudaria). */
  dryRun?: boolean;
  /** Eventos por transação. Padrão 1000. */
  batchSize?: number;
}

export interface RecomputeImportanceReport {
  examined: number;
  /** Eventos cujo `derby_id` foi preenchido ou limpo. */
  derbiesChanged: number;
  /** Eventos cuja importância mudou. */
  importanceChanged: number;
  /** Eventos que são clássico depois do recálculo. */
  derbies: number;
  dryRun: boolean;
}

/** Tópico interno do change feed (não sai no SSE/webhook): só purga o cache dos eventos afetados. */
export const IMPORTANCE_TOPIC = 'event.importance_recomputed';

type Row = {
  id: string;
  importance: number;
  derby_id: string | null;
  tier: number | null;
  stage_kind: string | null;
  intensity: number | null;
};

export async function recomputeEventImportance(
  db: Database,
  options: RecomputeImportanceOptions = {},
): Promise<RecomputeImportanceReport> {
  const report: RecomputeImportanceReport = {
    examined: 0,
    derbiesChanged: 0,
    importanceChanged: 0,
    derbies: 0,
    dryRun: options.dryRun ?? false,
  };
  const filters = [
    options.sport ? sql`and e.sport = ${options.sport}` : sql``,
    options.since ? sql`and e.starts_at >= ${options.since.toISOString()}::timestamptz` : sql``,
    options.eventIds
      ? options.eventIds.length
        ? sql`and e.id in (${sql.join(
            options.eventIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`
        : sql`and false`
      : sql``,
  ];
  const ids = (
    await db.execute<{ id: string }>(
      sql`select e.id from core.event e where true ${sql.join(filters, sql` `)} order by e.id`,
    )
  ).map((r) => r.id);

  for (const chunk of chunks(ids, options.batchSize ?? 1000)) {
    try {
      await db.transaction(async (tx) => {
        // 1) clássico pelo par de participantes (mesma rotina do seed semântico)
        const assigned = await assignEventDerbies(tx, { eventIds: chunk });
        report.derbiesChanged += assigned.updated;
        // 2) importância com a intensidade do clássico
        const rows = await tx.execute<Row>(sql`
          select e.id, e.importance, e.derby_id, c.tier, s.kind as stage_kind, d.intensity
            from core.event e
            left join core.competition c on c.id = e.competition_id
            left join core.stage s on s.id = e.stage_id
            left join semantic.derby d on d.id = e.derby_id
           where e.id in (${sql.join(
             chunk.map((id) => sql`${id}::uuid`),
             sql`, `,
           )})`);
        report.examined += rows.length;
        const changed: { id: string; score: number }[] = [];
        for (const r of rows) {
          if (r.derby_id) report.derbies += 1;
          const score = importance({
            tier: r.tier == null ? null : Number(r.tier),
            stageKind: (r.stage_kind as StageKind | null) ?? null,
            derby: r.derby_id ? { derbyId: r.derby_id, intensity: Number(r.intensity ?? 3) } : null,
          }).score;
          if (score !== Number(r.importance)) changed.push({ id: r.id, score });
        }
        report.importanceChanged += changed.length;
        // --plan: calcula tudo na transação e desfaz
        if (report.dryRun) tx.rollback();
        if (changed.length)
          await tx.execute(sql`
            update core.event e
               set importance = v.score, updated_at = now()
              from (values ${sql.join(
                changed.map((c) => sql`(${c.id}::uuid, ${c.score}::int)`),
                sql`, `,
              )}) as v(id, score)
             where e.id = v.id`);
        // purge do cache (detalhe e listas) dos eventos que mudaram
        const touched = [...new Set([...assigned.events.map((e) => e.id), ...changed.map((c) => c.id)])];
        if (touched.length)
          await publishChange(tx, {
            topic: IMPORTANCE_TOPIC,
            entityType: 'event',
            entityId: touched[0]!,
            payload: { events: touched.length, tags: touched.map((id) => `event:${id}`) },
          });
      });
    } catch (err) {
      if (!(report.dryRun && err instanceof TransactionRollbackError)) throw err;
    }
  }
  return report;
}
