/**
 * Custo do onde assistir por mercado: cada chamada (direitos por temporada ou alocação por rodada)
 * fica em enrich.wtw_research e o custo é rateado igualmente entre os mercados dela. O teto diário
 * por mercado (WTW_DAILY_USD_PER_MARKET) vale além do orçamento global de tokens — assim um mercado
 * não consome o dia dos outros.
 */
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { wtwResearch, type Database } from '@galaxie/db';
import type { UsageWithSearches } from '../llm/budget.js';

/** Estimativas iniciais (medidas no teste real de 2026-10-22; o histórico substitui quando houver). */
export const DEFAULT_CALL_USD = { allocation: 0.15, rights: 0.25, channel: 0.15 } as const;
export type ResearchKind = keyof typeof DEFAULT_CALL_USD;

export const dayStartUtc = (now: Date) => new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);

/** US$ gastos hoje (dia UTC) por mercado, com rateio pelos mercados de cada chamada. */
export async function marketSpendToday(db: Database, now: Date): Promise<Map<string, number>> {
  const rows = await db.execute<{ market: string; usd: string | null }>(sql`
    select m as market, sum(r.cost_usd / greatest(1, cardinality(r.markets))) as usd
      from enrich.wtw_research r, unnest(r.markets) as m
     where r.created_at >= ${dayStartUtc(now).toISOString()}::timestamptz
       and r.created_at < ${new Date(dayStartUtc(now).getTime() + 86_400_000).toISOString()}::timestamptz
       and r.cost_usd is not null
     group by m`);
  return new Map(rows.map((r) => [r.market, Number(r.usd ?? 0)]));
}

/** Custo médio das últimas chamadas desse tipo (ou a estimativa inicial). */
export async function estimateCallUsd(db: Database, kind: ResearchKind): Promise<number> {
  const rows = await db
    .select({ cost: wtwResearch.costUsd })
    .from(wtwResearch)
    .where(and(eq(wtwResearch.kind, kind), eq(wtwResearch.status, 'done'), isNotNull(wtwResearch.costUsd)))
    .orderBy(desc(wtwResearch.createdAt))
    .limit(20);
  const costs = rows.map((r) => Number(r.cost)).filter((n) => Number.isFinite(n) && n > 0);
  return costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : DEFAULT_CALL_USD[kind];
}

/** Mercados que ainda cabem no teto do dia com a parte deles da próxima chamada. */
export function withinCap(
  spend: Map<string, number>,
  markets: string[],
  estimateUsd: number,
  cap: number | null,
): { allowed: string[]; blocked: string[] } {
  if (cap === null) return { allowed: [...markets], blocked: [] };
  const share = estimateUsd / Math.max(1, markets.length);
  const allowed = markets.filter((m) => (spend.get(m) ?? 0) + share <= cap);
  return { allowed, blocked: markets.filter((m) => !allowed.includes(m)) };
}

export interface ResearchStart {
  kind: ResearchKind;
  researchKey: string;
  competition: string;
  season?: number | null;
  round?: string | null;
  markets: string[];
  requestedBy?: string;
  now: Date;
}

/**
 * Registra o início de uma chamada (idempotente por `research_key`): devolve null se a mesma
 * chave já rodou ou está rodando; falhas anteriores são reaproveitadas (nova tentativa).
 */
export async function startResearch(db: Database, s: ResearchStart): Promise<string | null> {
  const [existing] = await db
    .select({ id: wtwResearch.id, status: wtwResearch.status })
    .from(wtwResearch)
    .where(eq(wtwResearch.researchKey, s.researchKey));
  if (existing && ['done', 'running'].includes(existing.status)) return null;
  if (existing) {
    await db
      .update(wtwResearch)
      .set({ status: 'running', startedAt: s.now, error: null, markets: s.markets })
      .where(eq(wtwResearch.id, existing.id));
    return existing.id;
  }
  const [row] = await db
    .insert(wtwResearch)
    .values({
      kind: s.kind,
      researchKey: s.researchKey,
      competitionSlug: s.competition,
      season: s.season ?? null,
      round: s.round ?? null,
      markets: s.markets,
      status: 'running',
      requestedBy: s.requestedBy ?? 'scheduler',
      startedAt: s.now,
      createdAt: s.now,
    })
    .onConflictDoNothing({ target: wtwResearch.researchKey })
    .returning({ id: wtwResearch.id });
  return row?.id ?? null;
}

export async function finishResearch(
  db: Database,
  id: string,
  f: {
    status: 'done' | 'failed' | 'skipped';
    usage?: UsageWithSearches | undefined;
    model?: { provider: string; model: string } | undefined;
    stats?: Record<string, unknown>;
    error?: string | null;
    now: Date;
  },
): Promise<void> {
  await db
    .update(wtwResearch)
    .set({
      status: f.status,
      finishedAt: f.now,
      stats: f.stats ?? null,
      error: f.error ?? null,
      ...(f.usage
        ? {
            inputTokens: f.usage.inputTokens,
            outputTokens: f.usage.outputTokens,
            costUsd: f.usage.costUsd === undefined ? null : f.usage.costUsd.toFixed(6),
          }
        : {}),
      ...(f.model ? { provider: f.model.provider, model: f.model.model } : {}),
    })
    .where(eq(wtwResearch.id, id));
}
