/**
 * Prévia do recálculo (#880): roda o recálculo dentro de uma transação desfeita no fim, sem publicar no change
 * feed, e compara a tabela antes e depois. Serve para ver quais temporadas mudam e quanto antes de gravar.
 * A transação segura as linhas de `core.standing` da temporada enquanto calcula (cada temporada na sua).
 */
import { and, eq, sql } from 'drizzle-orm';
import { event, standing, type Database } from '@galaxie/db';
import { recomputeSeasonStandings, type RecomputeOptions, type SeasonStandingsReport } from './recompute.js';

export interface StandingSnapshotRow {
  group: string;
  participantId: string;
  rank: number;
  points: number;
  played: number;
  source: string;
}

export interface StandingsDiff {
  /** Linhas que existiam e continuam, com posição diferente. */
  moved: number;
  /** Maior mudança de posição de um time no mesmo grupo. */
  maxShift: number;
  /** Linhas com pontos diferentes (punição que o fornecedor aplicava, jogo que faltava no core...). */
  pointsChanged: number;
  /** Maior diferença de pontos de um time no mesmo grupo. */
  maxPointsDelta: number;
  /** Linhas com número de jogos diferente. */
  playedChanged: number;
  /** Linhas do fornecedor que passaram a calculadas. */
  providerReplaced: number;
  /** Linhas novas (grupo ou time que não existia) e linhas que saíram. */
  added: number;
  removed: number;
}

/** Compara duas fotos da tabela de uma temporada, pela chave (grupo, time). */
export function diffStandings(
  before: readonly StandingSnapshotRow[],
  after: readonly StandingSnapshotRow[],
): StandingsDiff {
  const key = (r: StandingSnapshotRow) => `${r.group}\u0000${r.participantId}`;
  const old = new Map(before.map((r) => [key(r), r]));
  const now = new Map(after.map((r) => [key(r), r]));
  const out: StandingsDiff = {
    moved: 0,
    maxShift: 0,
    pointsChanged: 0,
    maxPointsDelta: 0,
    playedChanged: 0,
    providerReplaced: 0,
    added: 0,
    removed: 0,
  };
  for (const [k, r] of now) {
    const prev = old.get(k);
    if (!prev) {
      out.added++;
      continue;
    }
    if (prev.rank !== r.rank) {
      out.moved++;
      out.maxShift = Math.max(out.maxShift, Math.abs(prev.rank - r.rank));
    }
    if (prev.points !== r.points) {
      out.pointsChanged++;
      out.maxPointsDelta = Math.max(out.maxPointsDelta, Math.abs(prev.points - r.points));
    }
    if (prev.played !== r.played) out.playedChanged++;
    if (prev.source === 'provider' && r.source === 'computed') out.providerReplaced++;
  }
  for (const k of old.keys()) if (!now.has(k)) out.removed++;
  return out;
}

async function snapshot(db: Database, seasonId: string): Promise<StandingSnapshotRow[]> {
  return db
    .select({
      group: standing.group,
      participantId: standing.participantId,
      rank: standing.rank,
      points: standing.points,
      played: standing.played,
      source: standing.source,
    })
    .from(standing)
    .where(eq(standing.seasonId, seasonId));
}

class Rollback extends Error {}

/** Recalcula a temporada numa transação desfeita e devolve o relatório e a diferença. Nada fica gravado. */
export async function simulateSeasonStandings(
  db: Database,
  seasonId: string,
  options: RecomputeOptions = {},
): Promise<{ report: SeasonStandingsReport; diff: StandingsDiff }> {
  let result: { report: SeasonStandingsReport; diff: StandingsDiff } | undefined;
  try {
    await db.transaction(async (tx) => {
      const t = tx as unknown as Database;
      const before = await snapshot(t, seasonId);
      const report = await recomputeSeasonStandings(t, seasonId, { ...options, publish: false });
      const after = await snapshot(t, seasonId);
      result = { report, diff: diffStandings(before, after) };
      throw new Rollback();
    });
  } catch (err) {
    if (!(err instanceof Rollback)) throw err;
  }
  return result!;
}

/**
 * Temporadas de futebol que o #880 pode mudar: têm linha do fornecedor e resultado encerrado, e são atuais (algum
 * jogo nos últimos `recentDays` dias ou marcado para o futuro). O histórico do bootstrap fica de fora: tabela
 * oficial antiga só se recalcula pedindo a temporada com `--temporada`. O beisebol fica fora do #880.
 */
export async function seasonsWithProviderTable(db: Database, recentDays = 60): Promise<string[]> {
  const since = new Date(Date.now() - recentDays * 86_400_000);
  const rows = await db
    .selectDistinct({ seasonId: standing.seasonId })
    .from(standing)
    .where(
      and(
        eq(standing.source, 'provider'),
        sql`exists (select 1 from ${event} where ${event.seasonId} = ${standing.seasonId}
          and ${event.status} = 'finished' and ${event.sport} = 'football')`,
        sql`exists (select 1 from ${event} where ${event.seasonId} = ${standing.seasonId}
          and ${event.startsAt} >= ${since.toISOString()})`,
      ),
    );
  return rows.map((r) => r.seasonId).sort();
}
