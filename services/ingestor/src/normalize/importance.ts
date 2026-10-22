/**
 * Recalcula clássico (`core.event.derby_id`) e importância dos eventos já gravados (issue #39, revisão
 * de 2026-10 em docs/06 §3).
 *
 * O upsert da normalização já grava a parte estrutural (tier, fase, perna do confronto, prestígio,
 * decisão do mata-mata e clássico). Este recálculo:
 * - corrige o que foi gravado antes do seed semântico ou de uma mudança na base/catálogo;
 * - soma os sinais da tabela (título, rebaixamento, vaga, eliminação em grupo) pelo motor de regras
 *   (`computeEventStakes` de `@galaxie/rules/db`), que precisa da classificação e por isso fica fora do
 *   caminho quente: só para jogos em aberto dentro do horizonte (padrão 7 dias). Fora dele, os sinais
 *   já gravados (`stake_flags`) ficam como estão — o jogo encerrado guarda o que estava em jogo.
 * Idempotente: só toca a linha cuja importância/detalhamento/clássico mudou e publica o purge de cache
 * dessas linhas no change feed.
 */
import { sql, TransactionRollbackError } from 'drizzle-orm';
import { publishChange, type Database, type EventImportanceBreakdown } from '@galaxie/db';
import { assignEventDerbies } from '@galaxie/knowledge';
import { isKnockoutStage, type StageKind } from '@galaxie/providers';
import { decisiveFlagsFromStakes } from '@galaxie/rules';
import { computeEventStakes, StakesCache } from '@galaxie/rules/db';
import {
  competitionRules,
  groupTies,
  importanceFromFacts,
  maxRounds,
  pairKey,
  rulesLegs,
  sameBreakdown,
  tieShape,
  totalRoundsOf,
} from './importance-facts.js';
import { chunks, type Executor } from './sql-helpers.js';

export interface RecomputeImportanceOptions {
  /** Só eventos deste esporte. */
  sport?: string;
  /** Só eventos com início a partir deste instante. */
  since?: Date;
  /** Só eventos com início antes deste instante. */
  until?: Date;
  /** Só estes eventos. */
  eventIds?: readonly string[];
  /** Calcula sem gravar (relatório do que mudaria). */
  dryRun?: boolean;
  /** Eventos por transação. Padrão 1000. */
  batchSize?: number;
  /**
   * Horizonte (dias a partir de agora) dos jogos em aberto que recebem os sinais da tabela. Padrão 7;
   * 0 desliga (preserva os sinais gravados).
   */
  stakesHorizonDays?: number;
  /**
   * Prestígio do catálogo por `esporte|slug`, por cima do gravado em `core.competition` (o `--plan`
   * enxerga o YAML novo antes de o CLI aplicá-lo).
   */
  prestigeOverride?: ReadonlyMap<string, number>;
  /** Relógio (testes). */
  now?: Date;
}

export interface RecomputeImportanceReport {
  examined: number;
  /** Eventos cujo `derby_id` foi preenchido ou limpo. */
  derbiesChanged: number;
  /** Eventos cuja importância (ou o detalhamento) mudou. */
  importanceChanged: number;
  /** Eventos que são clássico depois do recálculo. */
  derbies: number;
  /** Jogos em aberto no horizonte que passaram pelo motor de regras. */
  stakesComputed: number;
  /** Desses, quantos têm algum sinal da tabela (título, rebaixamento, vaga, eliminação). */
  withStakeFlags: number;
  dryRun: boolean;
}

/** Tópico interno do change feed (não sai no SSE/webhook): só purga o cache dos eventos afetados. */
export const IMPORTANCE_TOPIC = 'event.importance_recomputed';

/** Estados em que ainda há algo em jogo (stakes calculáveis). */
const OPEN_STATUSES = new Set(['scheduled', 'starting', 'live', 'break', 'postponed', 'suspended']);
/** Jogos que começaram há pouco ainda entram no horizonte (ao vivo). */
const STAKES_LOOKBACK_MS = 6 * 3600_000;

type Row = {
  id: string;
  sport: string;
  status: string;
  starts_at: string;
  importance: number;
  importance_breakdown: EventImportanceBreakdown | null;
  derby_id: string | null;
  season_id: string | null;
  season_year: number | null;
  stage_id: string | null;
  stage_kind: string | null;
  stage_label: string | null;
  competition_slug: string | null;
  competition_sport: string | null;
  tier: number | null;
  prestige: number | null;
  intensity: number | null;
  home_id: string | null;
  away_id: string | null;
};

const uuidList = (ids: readonly string[]) =>
  sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

async function loadRows(db: Executor, ids: readonly string[]): Promise<Row[]> {
  return db.execute<Row>(sql`
    select e.id, e.sport, e.status, e.starts_at, e.importance, e.importance_breakdown, e.derby_id,
           e.season_id, se.year as season_year, e.stage_id, s.kind as stage_kind, s.provider_label as stage_label,
           c.slug as competition_slug, c.sport as competition_sport, c.tier, c.prestige, d.intensity,
           (select ep.participant_id from core.event_participant ep
             where ep.event_id = e.id and ep.side = 'home' limit 1) as home_id,
           (select ep.participant_id from core.event_participant ep
             where ep.event_id = e.id and ep.side = 'away' limit 1) as away_id
      from core.event e
      left join core.competition c on c.id = e.competition_id
      left join core.season se on se.id = e.season_id
      left join core.stage s on s.id = e.stage_id
      left join semantic.derby d on d.id = e.derby_id
     where e.id in (${uuidList(ids)})`);
}

/** Sinais da tabela dos jogos em aberto no horizonte (fora da transação: o motor lê com o `db`). */
async function stakeFlagsFor(
  db: Database,
  rows: readonly Row[],
  window: { from: number; to: number } | null,
  cache: StakesCache,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!window) return out;
  for (const r of rows) {
    const startsAt = new Date(r.starts_at);
    const t = startsAt.getTime();
    if (r.sport !== 'football' || !OPEN_STATUSES.has(r.status) || t < window.from || t > window.to) continue;
    if (!r.home_id || !r.away_id || !r.competition_slug) continue;
    // mata-mata: a decisão é estrutural (perna e final), calculada sem a tabela
    if (isKnockoutStage(r.stage_kind as StageKind | null, r.stage_label)) continue;
    const result = await computeEventStakes(
      db,
      {
        id: r.id,
        sport: r.sport,
        startsAt,
        competition: { slug: r.competition_slug },
        season:
          r.season_id && r.season_year != null ? { id: r.season_id, year: Number(r.season_year) } : null,
        stage: r.stage_id && r.stage_kind ? { id: r.stage_id, kind: r.stage_kind } : null,
        home: { id: r.home_id },
        away: { id: r.away_id },
      },
      { cache },
    );
    out.set(r.id, decisiveFlagsFromStakes(result.stakes, result.rules));
  }
  return out;
}

export async function recomputeEventImportance(
  db: Database,
  options: RecomputeImportanceOptions = {},
): Promise<RecomputeImportanceReport> {
  const report: RecomputeImportanceReport = {
    examined: 0,
    derbiesChanged: 0,
    importanceChanged: 0,
    derbies: 0,
    stakesComputed: 0,
    withStakeFlags: 0,
    dryRun: options.dryRun ?? false,
  };
  const now = options.now ?? new Date();
  const horizonDays = options.stakesHorizonDays ?? 7;
  const window =
    horizonDays > 0
      ? { from: now.getTime() - STAKES_LOOKBACK_MS, to: now.getTime() + horizonDays * 86_400_000 }
      : null;
  const filters = [
    options.sport ? sql`and e.sport = ${options.sport}` : sql``,
    options.since ? sql`and e.starts_at >= ${options.since.toISOString()}::timestamptz` : sql``,
    options.until ? sql`and e.starts_at < ${options.until.toISOString()}::timestamptz` : sql``,
    options.eventIds
      ? options.eventIds.length
        ? sql`and e.id in (${uuidList(options.eventIds)})`
        : sql`and false`
      : sql``,
  ];
  const ids = (
    await db.execute<{ id: string }>(
      sql`select e.id from core.event e where true ${sql.join(filters, sql` `)} order by e.id`,
    )
  ).map((r) => r.id);
  const stakesCache = new StakesCache();

  for (const chunk of chunks(ids, options.batchSize ?? 1000)) {
    // sinais da tabela antes da transação (o motor de regras lê classificação e rodada pelo `db`)
    const stakeFlags = await stakeFlagsFor(db, await loadRows(db, chunk), window, stakesCache);
    report.stakesComputed += stakeFlags.size;
    report.withStakeFlags += [...stakeFlags.values()].filter((f) => f.length > 0).length;
    try {
      await db.transaction(async (tx) => {
        // 1) clássico pelo par de participantes (mesma rotina do seed semântico)
        const assigned = await assignEventDerbies(tx, { eventIds: chunk });
        report.derbiesChanged += assigned.updated;
        // 2) importância: fatos estruturais + clássico (já reatribuído) + sinais da tabela
        const rows = await loadRows(tx, chunk);
        report.examined += rows.length;

        const seasonIds = [...new Set(rows.flatMap((r) => (r.season_id ? [r.season_id] : [])))];
        const stageRows = seasonIds.length
          ? await tx.execute<{ season_id: string; provider_label: string | null }>(sql`
              select season_id, provider_label from core.stage
               where season_id in (${uuidList(seasonIds)}) and kind in ('regular', 'league_phase')`)
          : [];
        const rounds = maxRounds(stageRows.map((s) => ({ seasonId: s.season_id, label: s.provider_label })));

        const koStageIds = [
          ...new Set(
            rows.flatMap((r) =>
              r.stage_id && isKnockoutStage(r.stage_kind as StageKind | null, r.stage_label)
                ? [r.stage_id]
                : [],
            ),
          ),
        ];
        const tieRows = koStageIds.length
          ? await tx.execute<{ id: string; stage_id: string; starts_at: string; parts: string[] }>(sql`
              select e.id, e.stage_id, e.starts_at, array_agg(ep.participant_id::text) as parts
                from core.event e
                join core.event_participant ep on ep.event_id = e.id and ep.side in ('home', 'away')
               where e.stage_id in (${uuidList(koStageIds)}) and e.status <> 'cancelled'
               group by e.id, e.stage_id, e.starts_at`)
          : [];
        const ties = groupTies(
          tieRows.map((t) => ({
            key: t.id,
            stageId: t.stage_id,
            startsAt: new Date(t.starts_at),
            participants: t.parts,
          })),
        );

        const changed: { id: string; score: number; breakdown: EventImportanceBreakdown }[] = [];
        for (const r of rows) {
          if (r.derby_id) report.derbies += 1;
          const stageKind = (r.stage_kind as StageKind | null) ?? null;
          const rules = await competitionRules(
            r.competition_slug,
            r.season_year == null ? null : Number(r.season_year),
          );
          const sides = [r.home_id, r.away_id].filter((x): x is string => !!x);
          const pair =
            r.stage_id && isKnockoutStage(stageKind, r.stage_label) ? pairKey(r.stage_id, sides) : null;
          const { score, breakdown } = importanceFromFacts({
            tier: r.tier == null ? null : Number(r.tier),
            prestige:
              options.prestigeOverride?.get(`${r.competition_sport}|${r.competition_slug}`) ??
              Number(r.prestige ?? 0),
            stageKind,
            stageLabel: r.stage_label,
            totalRounds: totalRoundsOf(rules, r.season_id, stageKind, r.stage_label, rounds),
            knockout: pair
              ? tieShape({ key: r.id }, ties.get(pair) ?? [], rulesLegs(rules, stageKind, r.stage_label))
              : null,
            derby: r.derby_id ? { derbyId: r.derby_id, intensity: Number(r.intensity ?? 3) } : null,
            stakeFlags: stakeFlags.get(r.id) ?? r.importance_breakdown?.stake_flags ?? [],
          });
          if (score !== Number(r.importance) || !sameBreakdown(breakdown, r.importance_breakdown))
            changed.push({ id: r.id, score, breakdown });
        }
        report.importanceChanged += changed.length;
        // --plan: calcula tudo na transação e desfaz
        if (report.dryRun) tx.rollback();
        if (changed.length)
          await tx.execute(sql`
            update core.event e
               set importance = v.score, importance_breakdown = v.breakdown, updated_at = now()
              from (values ${sql.join(
                changed.map(
                  (c) => sql`(${c.id}::uuid, ${c.score}::int, ${JSON.stringify(c.breakdown)}::jsonb)`,
                ),
                sql`, `,
              )}) as v(id, score, breakdown)
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
