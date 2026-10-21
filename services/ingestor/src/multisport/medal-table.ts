import type { MedalType } from '@galaxie/db';

export interface MedalRowLike {
  nocCode: string;
  medal: MedalType;
  revokedAt?: Date | string | null;
}

export interface MedalTableRow {
  nocCode: string;
  gold: number;
  silver: number;
  bronze: number;
  total: number;
  rankByGold: number;
  rankByTotal: number;
}

/** Posição com empates ("1, 2, 2, 4"): igual ao rank() do PostgreSQL. */
function competitionRank<T>(sorted: T[], same: (a: T, b: T) => boolean): number[] {
  const ranks: number[] = [];
  sorted.forEach((row, i) => {
    ranks.push(i > 0 && same(sorted[i - 1]!, row) ? ranks[i - 1]! : i + 1);
  });
  return ranks;
}

/**
 * Quadro de medalhas derivado das linhas de medalha (nunca digitado). Cada linha vale uma medalha:
 * lutas com dois bronzes geram duas linhas; empates geram linhas extras; revogadas não contam.
 * rankByGold = padrão COI (ouro → prata → bronze); rankByTotal = total, desempatado por ouro → prata → bronze.
 * Mesma regra da view multisport.medal_table.
 */
export function deriveMedalTable(rows: MedalRowLike[]): MedalTableRow[] {
  const counts = new Map<string, { gold: number; silver: number; bronze: number }>();
  for (const r of rows) {
    if (r.revokedAt) continue;
    const c = counts.get(r.nocCode) ?? { gold: 0, silver: 0, bronze: 0 };
    if (r.medal === 'G') c.gold += 1;
    else if (r.medal === 'S') c.silver += 1;
    else c.bronze += 1;
    counts.set(r.nocCode, c);
  }
  const base = [...counts.entries()].map(([nocCode, c]) => ({
    nocCode,
    ...c,
    total: c.gold + c.silver + c.bronze,
  }));

  const byGold = [...base].sort(
    (a, b) =>
      b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.nocCode.localeCompare(b.nocCode),
  );
  const goldRanks = competitionRank(
    byGold,
    (a, b) => a.gold === b.gold && a.silver === b.silver && a.bronze === b.bronze,
  );
  const byTotal = [...base].sort(
    (a, b) =>
      b.total - a.total ||
      b.gold - a.gold ||
      b.silver - a.silver ||
      b.bronze - a.bronze ||
      a.nocCode.localeCompare(b.nocCode),
  );
  const totalRanks = competitionRank(
    byTotal,
    (a, b) => a.total === b.total && a.gold === b.gold && a.silver === b.silver && a.bronze === b.bronze,
  );
  const totalRankByNoc = new Map(byTotal.map((r, i) => [r.nocCode, totalRanks[i]!]));

  return byGold.map((r, i) => ({
    ...r,
    rankByGold: goldRanks[i]!,
    rankByTotal: totalRankByNoc.get(r.nocCode)!,
  }));
}
