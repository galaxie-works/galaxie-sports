import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { games, medalTable, medalTableSnapshot, noc, type Database } from '@galaxie/db';

/** Recalcula o quadro materializado de uma edição a partir da view (derivada da tabela de medalhas). */
export async function refreshMedalTableSnapshot(db: Database, gamesId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.delete(medalTableSnapshot).where(eq(medalTableSnapshot.gamesId, gamesId));
    const rows = await tx.execute<{ n: number }>(sql`
      with ins as (
        insert into multisport.medal_table_snapshot
          (games_id, noc_code, gold, silver, bronze, total, rank_by_gold, rank_by_total)
        select games_id, noc_code, gold, silver, bronze, total, rank_by_gold, rank_by_total
        from multisport.medal_table where games_id = ${gamesId}
        returning 1
      ) select count(*)::int as n from ins`);
    return rows[0]?.n ?? 0;
  });
}

export interface MedalTableEntry {
  nocCode: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
  rankByGold: number;
  rankByTotal: number;
}

/** Quadro de uma edição (view ao vivo), ordenado por ouro ou por total. */
export async function medalTableForGames(
  db: Database,
  gamesSlug: string,
  sort: 'gold' | 'total' = 'gold',
): Promise<MedalTableEntry[]> {
  const rows = await db
    .select({
      nocCode: medalTable.nocCode,
      gold: medalTable.gold,
      silver: medalTable.silver,
      bronze: medalTable.bronze,
      total: medalTable.total,
      rankByGold: medalTable.rankByGold,
      rankByTotal: medalTable.rankByTotal,
    })
    .from(medalTable)
    .innerJoin(games, eq(games.id, medalTable.gamesId))
    .where(eq(games.slug, gamesSlug))
    .orderBy(
      sort === 'gold' ? asc(medalTable.rankByGold) : asc(medalTable.rankByTotal),
      asc(medalTable.nocCode),
    );
  return rows;
}

export interface HistoryEntry {
  gamesSlug: string;
  type: string;
  season: string;
  year: number;
  nocCode: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
  rankByGold: number;
  rankByTotal: number;
}

/** Histórico por país (ex.: BRA em OG e PAN) — base de GET /v1/multisport/history/medals. */
export async function medalHistoryByNoc(
  db: Database,
  nocCodes: string[],
  types: ('OG' | 'PAN')[] = ['OG', 'PAN'],
): Promise<HistoryEntry[]> {
  return db
    .select({
      gamesSlug: games.slug,
      type: games.type,
      season: games.season,
      year: games.year,
      nocCode: medalTable.nocCode,
      gold: medalTable.gold,
      silver: medalTable.silver,
      bronze: medalTable.bronze,
      total: medalTable.total,
      rankByGold: medalTable.rankByGold,
      rankByTotal: medalTable.rankByTotal,
    })
    .from(medalTable)
    .innerJoin(games, eq(games.id, medalTable.gamesId))
    .innerJoin(noc, eq(noc.code, medalTable.nocCode))
    .where(and(inArray(medalTable.nocCode, nocCodes), inArray(games.type, types)))
    .orderBy(asc(games.year), asc(games.type), asc(games.season), asc(medalTable.nocCode));
}
