/**
 * Custo do onde assistir por mercado: cada chamada (direitos por temporada ou alocação por rodada)
 * fica em enrich.wtw_research e o custo é rateado igualmente entre os mercados dela. O teto diário
 * por mercado (WTW_DAILY_USD_PER_MARKET) vale além do orçamento global de tokens — assim um mercado
 * não consome o dia dos outros.
 */
import { and, desc, eq, gte, isNotNull, like, lt, sql } from 'drizzle-orm';
import { wtwResearch, type Database } from '@galaxie/db';
import type { UsageWithSearches } from '../llm/budget.js';
import { BudgetExceededError, LlmError } from '../llm/errors.js';

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

/**
 * Mercados que ainda cabem no teto do dia com a parte deles da próxima chamada. A parte é recalculada
 * a cada mercado bloqueado: com menos mercados, cada um paga mais da mesma chamada.
 */
export function withinCap(
  spend: Map<string, number>,
  markets: string[],
  estimateUsd: number,
  cap: number | null,
): { allowed: string[]; blocked: string[] } {
  if (cap === null) return { allowed: [...markets], blocked: [] };
  let allowed = [...markets];
  for (;;) {
    const share = estimateUsd / Math.max(1, allowed.length);
    const next = allowed.filter((m) => (spend.get(m) ?? 0) + share <= cap);
    if (next.length === allowed.length) break;
    allowed = next;
  }
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
  /**
   * Prefixo das chaves da mesma pesquisa (ex.: `alloc:<grupo>:`): as falhas do dia contam somadas na
   * família, então trocar os mercados da chave (teto, cobertura) não reinicia o limite de falhas.
   */
  family?: string;
  /** Gravado já no início (ex.: os jogos × mercados cobertos, para quem conferir enquanto roda). */
  stats?: Record<string, unknown>;
  now: Date;
}

/** Falhas por chave no dia (UTC) antes de desistir até o dia seguinte (provedor fora, timeout). */
export const WTW_RESEARCH_MAX_FAILURES = 3;

/** Espera depois da n-ésima falha do dia, entre execuções do agendador: 30 min, 1 h, 2 h (teto 6 h). */
export function researchBackoffMs(failures: number): number {
  return Math.min(30 * 60_000 * 2 ** Math.max(0, failures - 1), 6 * 3_600_000);
}

export type ResearchStartResult =
  /** Pode chamar o provedor; `failures` = falhas já registradas hoje nesta chave. */
  | { id: string; failures: number }
  /** Não chama: já feita, em andamento, esperando depois de uma falha ou desistida no dia. */
  | { id: null; reason: 'done' | 'running' | 'backoff' | 'exhausted'; retryAt?: Date };

const sameUtcDay = (a: Date, b: Date) => dayStartUtc(a).getTime() === dayStartUtc(b).getTime();

/**
 * Registra o início de uma chamada (idempotente por `research_key`): não chama se a mesma chave já
 * rodou ou está rodando. Falha anterior é reaproveitada (nova tentativa) depois da espera
 * (`researchBackoffMs`) e até WTW_RESEARCH_MAX_FAILURES falhas no dia. No mesmo dia (UTC), a tentativa
 * nova reaproveita a linha e o custo soma ao das anteriores (`finishResearch`); em outro dia, a linha
 * antiga sai da chave (`<chave>#<id>`, com o custo no dia dela) e a tentativa ganha uma linha nova —
 * o teto por mercado conta cada gasto no dia em que aconteceu.
 */
export async function startResearch(db: Database, s: ResearchStart): Promise<ResearchStartResult> {
  const [existing] = await db
    .select({
      id: wtwResearch.id,
      status: wtwResearch.status,
      failures: wtwResearch.failures,
      finishedAt: wtwResearch.finishedAt,
      createdAt: wtwResearch.createdAt,
    })
    .from(wtwResearch)
    .where(eq(wtwResearch.researchKey, s.researchKey));
  if (existing && (existing.status === 'done' || existing.status === 'running'))
    return { id: null, reason: existing.status };
  // falhas de outro dia não contam: o limite é por dia
  const own = existing?.finishedAt && sameUtcDay(existing.finishedAt, s.now) ? existing.failures : 0;
  let failures = own;
  // a espera é depois de uma falha do provedor; orçamento esgotado (`skipped`) tenta na próxima
  let lastFailure = existing?.status === 'failed' && own > 0 ? existing.finishedAt : null;
  if (s.family) {
    const fam = await familyFailures(db, s.family, s.now);
    failures = Math.max(own, fam.failures);
    if (fam.last && (!lastFailure || fam.last > lastFailure)) lastFailure = fam.last;
  }
  if (failures >= WTW_RESEARCH_MAX_FAILURES) return { id: null, reason: 'exhausted' };
  if (failures > 0 && lastFailure) {
    const retryAt = new Date(lastFailure.getTime() + researchBackoffMs(failures));
    if (retryAt > s.now) return { id: null, reason: 'backoff', retryAt };
  }
  if (existing && !sameUtcDay(existing.createdAt, s.now)) {
    // tentativa de outro dia: a linha antiga guarda o gasto daquele dia; a chave vai para uma nova
    const [moved] = await db
      .update(wtwResearch)
      .set({ researchKey: `${s.researchKey}#${existing.id}` })
      .where(and(eq(wtwResearch.id, existing.id), eq(wtwResearch.status, existing.status)))
      .returning({ id: wtwResearch.id });
    if (!moved) return { id: null, reason: 'running' };
  } else if (existing) {
    const [row] = await db
      .update(wtwResearch)
      .set({
        status: 'running',
        startedAt: s.now,
        createdAt: s.now,
        failures: own,
        error: null,
        markets: s.markets,
        ...(s.stats ? { stats: s.stats } : {}),
      })
      // outra execução pode ter pegado a mesma tentativa entre a leitura e aqui
      .where(and(eq(wtwResearch.id, existing.id), eq(wtwResearch.status, existing.status)))
      .returning({ id: wtwResearch.id });
    return row ? { id: row.id, failures } : { id: null, reason: 'running' };
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
      stats: s.stats ?? null,
      failures: own,
      startedAt: s.now,
      createdAt: s.now,
    })
    .onConflictDoNothing({ target: wtwResearch.researchKey })
    .returning({ id: wtwResearch.id });
  return row ? { id: row.id, failures } : { id: null, reason: 'running' };
}

/**
 * Pesquisa `running` há mais que isso foi interrompida: o job (`wtw-run`, `wtw-channel`) tem teto de
 * 20 min no agendador e um deploy ou o teto mata o processo no meio da chamada, sem `finishResearch`.
 */
export const WTW_RESEARCH_STALE_MS = 30 * 60_000;

/**
 * Fecha como falha (soma uma no dia, abre a espera) as pesquisas presas em `running`. Sem isso a chave
 * ficava "em andamento" para sempre: `startResearch` não chamava de novo e o canal do jogo dava os
 * jogos daquele momento como já pesquisados — o momento estava perdido.
 */
export async function reapStaleResearch(db: Database, now: Date): Promise<number> {
  const rows = await db
    .update(wtwResearch)
    .set({
      status: 'failed',
      failures: sql`${wtwResearch.failures} + 1`,
      // o fim real não se sabe: conta do teto (a espera depois da falha corre dali, não de agora)
      finishedAt: sql`${wtwResearch.startedAt} + ${`${WTW_RESEARCH_STALE_MS / 60_000} minutes`}::interval`,
      error: 'interrompida: o processo terminou antes de fechar a pesquisa',
      // o provedor pode ter cobrado a chamada interrompida: entra a estimativa do tipo no teto do
      // mercado, como no timeout (`failureUsage`)
      costUsd: sql`coalesce(${wtwResearch.costUsd}, 0) + (case ${wtwResearch.kind} ${sql.join(
        Object.entries(DEFAULT_CALL_USD).map(([k, v]) => sql`when ${k} then ${v}::numeric`),
        sql` `,
      )} else 0 end)`,
    })
    .where(
      and(
        eq(wtwResearch.status, 'running'),
        lt(wtwResearch.startedAt, new Date(now.getTime() - WTW_RESEARCH_STALE_MS)),
      ),
    )
    .returning({ id: wtwResearch.id });
  return rows.length;
}

/** Falhas de hoje (UTC) somadas nas chaves da família, e a mais recente. */
async function familyFailures(
  db: Database,
  family: string,
  now: Date,
): Promise<{ failures: number; last: Date | null }> {
  const [r] = await db
    .select({
      failures: sql<number>`coalesce(sum(${wtwResearch.failures}), 0)::int`,
      last: sql<string | null>`max(${wtwResearch.finishedAt})`,
    })
    .from(wtwResearch)
    .where(
      and(
        like(wtwResearch.researchKey, `${family.replace(/[\\%_]/g, '\\$&')}%`),
        eq(wtwResearch.status, 'failed'),
        gte(wtwResearch.finishedAt, dayStartUtc(now)),
      ),
    );
  return { failures: Number(r?.failures ?? 0), last: r?.last ? new Date(r.last) : null };
}

/**
 * Fecha a tentativa. Tokens e custo SOMAM aos das tentativas anteriores do dia (o teto por mercado
 * não subconta a pesquisa retentada); `failed` soma uma falha no dia.
 */
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
      ...(f.status === 'failed' ? { failures: sql`${wtwResearch.failures} + 1` } : {}),
      ...(f.usage
        ? {
            inputTokens: sql`${wtwResearch.inputTokens} + ${Math.round(f.usage.inputTokens)}`,
            outputTokens: sql`${wtwResearch.outputTokens} + ${Math.round(f.usage.outputTokens)}`,
            ...(f.usage.costUsd === undefined
              ? {}
              : {
                  costUsd: sql`coalesce(${wtwResearch.costUsd}, 0) + ${f.usage.costUsd.toFixed(6)}::numeric`,
                }),
          }
        : {}),
      ...(f.model ? { provider: f.model.provider, model: f.model.model } : {}),
    })
    .where(eq(wtwResearch.id, id));
}

/**
 * Falha que não é desta pesquisa: orçamento esgotado, IA desligada ou conta do provedor sem crédito.
 * Fica `skipped` — não soma no limite de falhas do dia nem abre espera —, então a próxima execução do
 * agendador tenta de novo assim que o crédito volta (a checagem de crédito de hora em hora alerta).
 * Contar como falha fazia 3 erros de crédito de madrugada encerrarem a família no dia UTC inteiro.
 */
export function isOutage(err: unknown): boolean {
  return err instanceof BudgetExceededError || (err instanceof LlmError && err.kind === 'quota');
}

/**
 * Uso a registrar numa falha: o parcial que o provedor devolveu ou, no timeout sem parcial, a
 * estimativa da chamada — o provedor pode ter processado (e cobrado) o pedido; sem isso o teto por
 * mercado não via o gasto.
 */
export function failureUsage(
  err: unknown,
  estimateUsd: number,
): { usage: UsageWithSearches | undefined; stats?: Record<string, unknown> } {
  const partial = (err as { usage?: UsageWithSearches } | null)?.usage;
  if (partial) return { usage: partial };
  if (err instanceof LlmError && err.kind === 'timeout')
    return {
      usage: { inputTokens: 0, outputTokens: 0, costUsd: estimateUsd },
      stats: { costEstimated: true },
    };
  return { usage: undefined };
}
