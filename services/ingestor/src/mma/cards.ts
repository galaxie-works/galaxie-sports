/**
 * Reagrupa as lutas de MMA já gravadas nos cards (`fight_card`). A normalização passou a usar o card como fase
 * (antes era a categoria de peso), mas reprocessar o mesmo raw não mexe no contexto dos eventos (a observação é
 * a mesma, "fora de ordem"). Aqui: cada luta vai para o card do seu dia, os nomes de lutador com UTF-8 lido como
 * Latin-1 são corrigidos e as fases que ficaram sem luta são apagadas. Só toca em dados de MMA.
 * Rode depois de `normalize:sports mma --tudo` (que cria os cards). Idempotente.
 */
import { competition, event, participant, season, sportEventDetail, stage, type Database } from '@galaxie/db';
import { fixMojibake, mmaCardLabel } from '@galaxie/providers';
import { and, eq, inArray, like, notExists, or, sql } from 'drizzle-orm';

export interface MmaRegroupStats {
  fights: number;
  moved: number;
  withoutCard: number;
  renamed: number;
  removedStages: number;
}

function startOf(summary: Record<string, unknown>, fallback: Date): Date {
  const ts = Number(summary.timestamp);
  if (Number.isFinite(ts) && ts > 0) return new Date(ts * 1000);
  const d = typeof summary.date === 'string' ? new Date(summary.date) : null;
  return d && !Number.isNaN(d.getTime()) ? d : fallback;
}

export async function regroupMmaCards(db: Database): Promise<MmaRegroupStats> {
  const stats: MmaRegroupStats = { fights: 0, moved: 0, withoutCard: 0, renamed: 0, removedStages: 0 };
  const fights = await db
    .select({
      id: event.id,
      seasonId: event.seasonId,
      stageId: event.stageId,
      startsAt: event.startsAt,
      summary: sportEventDetail.summary,
    })
    .from(event)
    .innerJoin(sportEventDetail, eq(sportEventDetail.eventId, event.id))
    .where(eq(event.sport, 'mma'));
  stats.fights = fights.length;

  const seasonIds = [...new Set(fights.map((f) => f.seasonId).filter((s): s is string => !!s))];
  const cards = new Map<string, string>();
  if (seasonIds.length) {
    const rows = await db
      .select({ id: stage.id, seasonId: stage.seasonId, label: stage.providerLabel })
      .from(stage)
      .where(and(inArray(stage.seasonId, seasonIds), eq(stage.kind, 'fight_card')));
    for (const r of rows) cards.set(`${r.seasonId}|${r.label}`, r.id);
  }

  const moves = new Map<string, string[]>();
  for (const f of fights) {
    const summary = f.summary as Record<string, unknown>;
    const label = mmaCardLabel(summary.slug, startOf(summary, f.startsAt));
    const cardId = f.seasonId ? cards.get(`${f.seasonId}|${label}`) : undefined;
    if (!cardId) {
      stats.withoutCard += 1;
      continue;
    }
    if (cardId !== f.stageId) moves.set(cardId, [...(moves.get(cardId) ?? []), f.id]);
  }
  await db.transaction(async (tx) => {
    for (const [cardId, ids] of moves) {
      await tx.update(event).set({ stageId: cardId, updatedAt: new Date() }).where(inArray(event.id, ids));
      stats.moved += ids.length;
    }

    const fighters = await tx
      .select({ id: participant.id, name: participant.name })
      .from(participant)
      .where(eq(participant.sport, 'mma'));
    for (const p of fighters) {
      const fixed = fixMojibake(p.name);
      if (fixed === p.name) continue;
      await tx.update(participant).set({ name: fixed, updatedAt: new Date() }).where(eq(participant.id, p.id));
      stats.renamed += 1;
    }

    // fases das temporadas de MMA que ficaram sem luta: categorias de peso (modelo antigo) e cards de rótulo antigo
    const mmaSeasons = tx
      .select({ id: season.id })
      .from(season)
      .innerJoin(competition, and(eq(competition.id, season.competitionId), eq(competition.sport, 'mma')));
    const removed = await tx
      .delete(stage)
      .where(
        and(
          or(like(stage.providerLabel, 'category-%'), eq(stage.kind, 'fight_card')),
          inArray(stage.seasonId, mmaSeasons),
          notExists(tx.select({ one: sql`1` }).from(event).where(eq(event.stageId, stage.id))),
        ),
      )
      .returning({ id: stage.id });
    stats.removedStages = removed.length;
  });
  return stats;
}
