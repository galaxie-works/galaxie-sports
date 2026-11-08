/**
 * Grava palpites, odds e casas de apostas (`MarketsBatch` de `@galaxie/providers`) em `core.event_prediction`,
 * `core.event_odds` e `core.bookmaker` (docs/04 §2.4).
 *
 * - Jogo, times e casas pelos nossos IDs, resolvidos pelo `core.provider_map`. Jogo que ainda não está no core
 *   fica de fora (conta em `missingEvent`): o palpite volta na próxima busca, depois que a agenda gravar o jogo.
 * - Uma resposta mais velha que a gravada não sobrescreve (`observed_at`).
 * - Odds: a foto mais nova do jogo substitui a anterior; casa que sumiu da resposta sai do jogo.
 * - Idempotente: regravar o mesmo lote não muda nada (nem `updated_at`).
 */
import { and, eq, notInArray, sql } from 'drizzle-orm';
import { bookmaker, eventOdds, eventPrediction, type Database } from '@galaxie/db';
import type { MarketsBatch } from '@galaxie/providers';
import { slugify } from './slug.js';
import { linkIds, resolveIds, type ProviderScope, type Tx } from './sql-helpers.js';

export interface MarketsStats {
  predictions: number;
  odds: number;
  oddsRemoved: number;
  bookmakersCreated: number;
  missingEvent: number;
  /** Respostas mais velhas que o já gravado. */
  older: number;
}

export function emptyMarketsStats(): MarketsStats {
  return { predictions: 0, odds: 0, oddsRemoved: 0, bookmakersCreated: 0, missingEvent: 0, older: 0 };
}

export async function upsertMarkets(
  db: Pick<Database, 'transaction'>,
  batch: MarketsBatch,
): Promise<MarketsStats> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`markets:${batch.provider}:${batch.sport}`}))`,
    );
    return upsertMarketsInTx(tx, batch);
  });
}

export async function upsertMarketsInTx(tx: Tx, batch: MarketsBatch): Promise<MarketsStats> {
  const scope: ProviderScope = { provider: batch.provider, sport: batch.sport };
  const stats = emptyMarketsStats();
  const observedAt = batch.observedAt.toISOString();

  // ─ casas: pelo provider_map; casa nova com o mesmo nome de outra API (mesmo slug) é a mesma casa ─
  const bookmakerNames = new Map<string, string>();
  for (const b of batch.bookmakers) bookmakerNames.set(b.id, b.name);
  for (const o of batch.odds)
    for (const b of o.bookmakers) bookmakerNames.set(b.bookmakerId, b.bookmakerName);
  const bookmakerIds = await resolveIds(tx, scope, 'bookmaker', [...bookmakerNames.keys()]);
  const links: { providerId: string; entityId: string }[] = [];
  for (const [pid, name] of bookmakerNames) {
    if (bookmakerIds.has(pid)) continue;
    const slug = slugify(name) || `bookmaker-${batch.sport}-${pid}`;
    const inserted = await tx
      .insert(bookmaker)
      .values({ name, slug })
      .onConflictDoNothing({ target: bookmaker.slug })
      .returning({ id: bookmaker.id });
    if (inserted[0]) stats.bookmakersCreated += 1;
    const id =
      inserted[0]?.id ??
      (await tx.select({ id: bookmaker.id }).from(bookmaker).where(eq(bookmaker.slug, slug)))[0]!.id;
    bookmakerIds.set(pid, id);
    links.push({ providerId: pid, entityId: id });
  }
  await linkIds(tx, scope, 'bookmaker', links);

  const eventIds = await resolveIds(tx, scope, 'event', [
    ...batch.predictions.map((p) => p.eventId),
    ...batch.odds.map((o) => o.eventId),
  ]);

  // ─ palpites ─
  const teamIds = await resolveIds(
    tx,
    scope,
    'participant',
    batch.predictions.flatMap((p) => (p.winnerTeamId ? [p.winnerTeamId] : [])),
  );
  const ep = eventPrediction;
  for (const p of batch.predictions) {
    const eventId = eventIds.get(p.eventId);
    if (!eventId) {
      stats.missingEvent += 1;
      continue;
    }
    const values = {
      eventId,
      provider: batch.provider,
      winnerParticipantId: p.winnerTeamId ? (teamIds.get(p.winnerTeamId) ?? null) : null,
      winOrDraw: p.winOrDraw,
      probHome: p.probHome,
      probDraw: p.probDraw,
      probAway: p.probAway,
      goals: p.goals,
      comparison: p.comparison,
      recentForm: p.recentForm,
      advice: p.advice,
      winnerComment: p.winnerComment,
      observedAt: batch.observedAt,
    };
    const changed = sql`(${ep.winnerParticipantId}, ${ep.winOrDraw}, ${ep.probHome}, ${ep.probDraw}, ${ep.probAway}, ${ep.goals}, ${ep.comparison}, ${ep.recentForm}, ${ep.advice}, ${ep.winnerComment}) is distinct from (excluded.winner_participant_id, excluded.win_or_draw, excluded.prob_home, excluded.prob_draw, excluded.prob_away, excluded.goals, excluded.comparison, excluded.recent_form, excluded.advice, excluded.winner_comment)`;
    const rows = await tx
      .insert(ep)
      .values(values)
      .onConflictDoUpdate({
        target: ep.eventId,
        set: {
          provider: sql`excluded.provider`,
          winnerParticipantId: sql`excluded.winner_participant_id`,
          winOrDraw: sql`excluded.win_or_draw`,
          probHome: sql`excluded.prob_home`,
          probDraw: sql`excluded.prob_draw`,
          probAway: sql`excluded.prob_away`,
          goals: sql`excluded.goals`,
          comparison: sql`excluded.comparison`,
          recentForm: sql`excluded.recent_form`,
          advice: sql`excluded.advice`,
          winnerComment: sql`excluded.winner_comment`,
          observedAt: sql`excluded.observed_at`,
          // o observed_at avança com a resposta mais nova; updated_at só quando o palpite muda
          updatedAt: sql`case when ${changed} then now() else ${ep.updatedAt} end`,
        },
        // só a resposta mais nova (ou a mesma, se mudou): regravar o mesmo lote não toca a linha
        setWhere: sql`${ep.observedAt} < excluded.observed_at or (${ep.observedAt} = excluded.observed_at and ${changed})`,
      })
      .returning({ eventId: ep.eventId });
    if (rows.length) stats.predictions += 1;
  }

  // ─ odds ─
  const eo = eventOdds;
  const oddsChanged = sql`(${eo.markets}, ${eo.sourceUpdatedAt}) is distinct from (excluded.markets, excluded.source_updated_at)`;
  for (const o of batch.odds) {
    const eventId = eventIds.get(o.eventId);
    if (!eventId) {
      stats.missingEvent += 1;
      continue;
    }
    const [newer] = await tx
      .select({ yes: sql<boolean>`coalesce(bool_or(${eo.observedAt} > ${observedAt}::timestamptz), false)` })
      .from(eo)
      .where(eq(eo.eventId, eventId));
    if (newer?.yes) {
      stats.older += 1;
      continue;
    }
    const keep: string[] = [];
    for (const b of o.bookmakers) {
      const bookmakerId = bookmakerIds.get(b.bookmakerId);
      if (!bookmakerId) continue;
      keep.push(bookmakerId);
      const rows = await tx
        .insert(eo)
        .values({
          eventId,
          bookmakerId,
          provider: batch.provider,
          markets: b.markets,
          sourceUpdatedAt: o.sourceUpdatedAt,
          observedAt: batch.observedAt,
        })
        .onConflictDoUpdate({
          target: [eo.eventId, eo.bookmakerId],
          set: {
            markets: sql`excluded.markets`,
            sourceUpdatedAt: sql`excluded.source_updated_at`,
            observedAt: sql`excluded.observed_at`,
            updatedAt: sql`case when ${oddsChanged} then now() else ${eo.updatedAt} end`,
          },
          setWhere: sql`${eo.observedAt} < excluded.observed_at or (${eo.observedAt} = excluded.observed_at and ${oddsChanged})`,
        })
        .returning({ eventId: eo.eventId });
      if (rows.length) stats.odds += 1;
    }
    const removed = await tx
      .delete(eo)
      .where(
        and(
          eq(eo.eventId, eventId),
          sql`${eo.observedAt} <= ${observedAt}::timestamptz`,
          keep.length ? notInArray(eo.bookmakerId, keep) : undefined,
        ),
      )
      .returning({ bookmakerId: eo.bookmakerId });
    stats.oddsRemoved += removed.length;
  }
  return stats;
}

/** Soma de estatísticas (relatório dos jobs). */
export function addMarketsStats(a: MarketsStats, b: MarketsStats): MarketsStats {
  return {
    predictions: a.predictions + b.predictions,
    odds: a.odds + b.odds,
    oddsRemoved: a.oddsRemoved + b.oddsRemoved,
    bookmakersCreated: a.bookmakersCreated + b.bookmakersCreated,
    missingEvent: a.missingEvent + b.missingEvent,
    older: a.older + b.older,
  };
}
