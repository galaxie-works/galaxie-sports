/**
 * Cota da carteira por sala e produto (#1116). O dono reparte o saldo em %: chat ao vivo (`chat`, ou uma sala,
 * `chat:<id>`), cada comunidade (`community:<id>`), bolão (`pool`). A base é o saldo do ciclo (`wallet.cycle_base`,
 * o saldo livre logo depois da última entrada de créditos), a mesma dos alertas de 80% e 90%.
 *
 * - O que uma sala já usou no ciclo: o uso do extrato com aquele escopo desde o início do ciclo, mais as reservas
 *   abertas dela. A reserva confere com a carteira travada (`FOR UPDATE`), então reservas simultâneas nunca passam da
 *   cota.
 * - Escopo sem cota usa só o saldo da carteira. Vale a cota mais específica (`chat:<sala>` antes de `chat`).
 * - A soma pode passar de 100%: a tela avisa, e cada reserva continua limitada pelo saldo real.
 * - Mudar as cotas grava um lançamento `quota_change` (0 crédito) no extrato, com as cotas novas.
 */
import { and, eq, gte, like, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
// subcaminhos, não o índice: o índice traz o migrator (pasta drizzle/), que o bundler do Next não resolve
import type { Database } from '@galaxie/db/client';
import { ledger, reservation, wallet, walletQuota } from '@galaxie/db/schema';
import { roundCredits } from './credits.js';
import { CosmosError } from './errors.js';

/** Produtos que podem ter cota. */
export const QUOTA_PRODUCTS = ['chat', 'community', 'pool'] as const;
export type QuotaProduct = (typeof QUOTA_PRODUCTS)[number];

/** Até quantas cotas por tenant. */
export const QUOTAS_MAX = 50;

const SCOPE = /^(chat|community|pool)(?::([A-Za-z0-9_.-]{1,120}))?$/;

export interface Quota {
  scope: string;
  /** % do saldo do ciclo, com até duas casas. */
  percent: number;
}

export const isQuotaScope = (v: unknown): v is string => typeof v === 'string' && SCOPE.test(v);

/** Valida as cotas vindas da tela; null se algo não serve (escopo fora do formato, % fora de 0–100, repetição). */
export function parseQuotas(input: unknown): Quota[] | null {
  if (!Array.isArray(input) || input.length > QUOTAS_MAX) return null;
  const seen = new Set<string>();
  const out: Quota[] = [];
  for (const item of input) {
    if (typeof item !== 'object' || item === null) return null;
    const { scope, percent } = item as Record<string, unknown>;
    if (!isQuotaScope(scope) || seen.has(scope)) return null;
    if (typeof percent !== 'number' || !Number.isFinite(percent) || percent <= 0 || percent > 100)
      return null;
    seen.add(scope);
    out.push({ scope, percent: Math.round(percent * 100) / 100 });
  }
  return out;
}

/** A cota que vale para um escopo de reserva: a mais específica; null = sem cota. */
export function quotaFor(scope: string | null | undefined, quotas: readonly Quota[]): Quota | null {
  if (!scope) return null;
  const exact = quotas.find((q) => q.scope === scope);
  if (exact) return exact;
  const product = scope.split(':')[0]!;
  return quotas.find((q) => q.scope === product) ?? null;
}

/** Créditos da cota no ciclo. */
export const quotaCredits = (percent: number, cycleBase: number) => roundCredits((cycleBase * percent) / 100);

type Reader = Pick<Database, 'select'>;

/** Escopos que contam para uma cota: o próprio e, na cota do produto, as salas sem cota própria. */
function scopeFilter(col: AnyPgColumn, quota: Quota, quotas: readonly Quota[]): SQL {
  if (quota.scope.includes(':')) return eq(col, quota.scope);
  // cota do produto: o produto e as salas dele que não têm cota própria
  const own = quotas.filter((q) => q.scope.startsWith(`${quota.scope}:`)).map((q) => q.scope);
  const rooms = like(col, `${quota.scope}:%`);
  const base = or(eq(col, quota.scope), rooms)!;
  return own.length
    ? and(
        base,
        sql`${col} not in (${sql.join(
          own.map((s) => sql`${s}`),
          sql`, `,
        )})`,
      )!
    : base;
}

/** O que a cota já usou no ciclo: uso do extrato desde o início do ciclo mais as reservas abertas. */
export async function quotaUsed(
  db: Reader,
  tenantId: string,
  quota: Quota,
  quotas: readonly Quota[],
  cycleStartedAt: Date | null,
): Promise<number> {
  const [spent] = await db
    .select({ n: sql<string>`coalesce(sum(-${ledger.credits}), 0)` })
    .from(ledger)
    .where(
      and(
        eq(ledger.tenantId, tenantId),
        eq(ledger.kind, 'usage'),
        scopeFilter(ledger.scope, quota, quotas),
        ...(cycleStartedAt ? [gte(ledger.createdAt, cycleStartedAt)] : []),
      ),
    );
  const [held] = await db
    .select({ n: sql<string>`coalesce(sum(${reservation.credits}), 0)` })
    .from(reservation)
    .where(
      and(
        eq(reservation.tenantId, tenantId),
        eq(reservation.status, 'open'),
        scopeFilter(reservation.scope, quota, quotas),
      ),
    );
  return roundCredits(Number(spent?.n ?? 0) + Number(held?.n ?? 0));
}

export async function listQuotas(db: Reader, tenantId: string): Promise<Quota[]> {
  const rows = await db
    .select({ scope: walletQuota.scope, percent: walletQuota.percent })
    .from(walletQuota)
    .where(eq(walletQuota.tenantId, tenantId));
  return rows.sort((a, b) => a.scope.localeCompare(b.scope));
}

/**
 * Confere a cota dentro da transação da reserva, com a carteira já travada. Recusa (`quota_exceeded`) quando a sala
 * passaria da cota com este pedido.
 */
export async function assertQuota(
  tx: Reader,
  input: { tenantId: string; scope: string | null | undefined; credits: number },
  cycle: { base: number; startedAt: Date | null },
): Promise<void> {
  if (!input.scope || !SCOPE.test(input.scope)) return;
  const product = input.scope.split(':')[0]!;
  const candidates = await tx
    .select({ scope: walletQuota.scope, percent: walletQuota.percent })
    .from(walletQuota)
    .where(
      and(
        eq(walletQuota.tenantId, input.tenantId),
        or(eq(walletQuota.scope, input.scope), like(walletQuota.scope, `${product}%`)),
      ),
    );
  const quota = quotaFor(input.scope, candidates);
  if (!quota) return;
  const used = await quotaUsed(tx, input.tenantId, quota, candidates, cycle.startedAt);
  if (used + input.credits > quotaCredits(quota.percent, cycle.base))
    throw new CosmosError('quota_exceeded', `a cota de ${quota.scope} não cobre este pedido`);
}

export interface QuotaStatus extends Quota {
  /** Créditos da cota no ciclo. */
  credits: number;
  used: number;
  remaining: number;
}

export interface QuotaOverview {
  quotas: QuotaStatus[];
  /** Soma das % (pode passar de 100). */
  totalPercent: number;
  /** % sem destino (nunca negativa). */
  unassignedPercent: number;
  cycleBase: number;
}

/** Cotas do tenant com o uso no ciclo, para a tela. */
export async function readQuotaOverview(db: Reader, tenantId: string): Promise<QuotaOverview> {
  const [w] = await db
    .select({ cycleBase: wallet.cycleBase, cycleStartedAt: wallet.cycleStartedAt })
    .from(wallet)
    .where(eq(wallet.tenantId, tenantId));
  const quotas = await listQuotas(db, tenantId);
  const cycleBase = w?.cycleBase ?? 0;
  const out: QuotaStatus[] = [];
  for (const q of quotas) {
    const credits = quotaCredits(q.percent, cycleBase);
    const used = await quotaUsed(db, tenantId, q, quotas, w?.cycleStartedAt ?? null);
    out.push({ ...q, credits, used, remaining: roundCredits(Math.max(0, credits - used)) });
  }
  const totalPercent = Math.round(quotas.reduce((n, q) => n + q.percent, 0) * 100) / 100;
  return {
    quotas: out,
    totalPercent,
    unassignedPercent: Math.max(0, Math.round((100 - totalPercent) * 100) / 100),
    cycleBase,
  };
}

/**
 * Troca as cotas do tenant (as que não vierem saem) e grava o lançamento `quota_change` no extrato, com 0 crédito e as
 * cotas novas. Recusa cotas inválidas (`invalid_quota`) e tenant sem carteira (`no_wallet`).
 */
export async function setQuotas(
  db: Database,
  input: { tenantId: string; quotas: unknown; userId: string },
): Promise<Quota[]> {
  const quotas = parseQuotas(input.quotas);
  if (!quotas) throw new CosmosError('invalid_quota', 'cotas inválidas');
  return db.transaction(async (tx) => {
    const [w] = await tx
      .select({ available: wallet.available })
      .from(wallet)
      .where(eq(wallet.tenantId, input.tenantId))
      .for('update');
    if (!w) throw new CosmosError('no_wallet', 'o tenant ainda não ligou a Cosmos');
    const keep = quotas.map((q) => q.scope);
    await tx.delete(walletQuota).where(
      keep.length
        ? and(
            eq(walletQuota.tenantId, input.tenantId),
            sql`${walletQuota.scope} not in (${sql.join(
              keep.map((s) => sql`${s}`),
              sql`, `,
            )})`,
          )
        : eq(walletQuota.tenantId, input.tenantId),
    );
    for (const q of quotas)
      await tx
        .insert(walletQuota)
        .values({ tenantId: input.tenantId, scope: q.scope, percent: q.percent, updatedBy: input.userId })
        .onConflictDoUpdate({
          target: [walletQuota.tenantId, walletQuota.scope],
          set: { percent: q.percent, updatedBy: input.userId, updatedAt: sql`now()` },
        });
    await tx.insert(ledger).values({
      tenantId: input.tenantId,
      kind: 'quota_change',
      credits: 0,
      balanceBefore: w.available,
      balanceAfter: w.available,
      userId: input.userId,
      metadata: { quotas },
    });
    return quotas;
  });
}

/** Aumenta (ou cria) a cota de uma sala em pontos percentuais, até 100% (aprovar o pedido de créditos, #996). */
export async function raiseQuota(
  db: Database,
  input: { tenantId: string; scope: string; addPercent: number; userId: string },
): Promise<Quota[]> {
  if (!isQuotaScope(input.scope) || !(input.addPercent > 0))
    throw new CosmosError('invalid_quota', 'cota inválida');
  const current = await listQuotas(db, input.tenantId);
  const found = current.find((q) => q.scope === input.scope);
  const next = found
    ? current.map((q) => (q === found ? { ...q, percent: Math.min(100, q.percent + input.addPercent) } : q))
    : [...current, { scope: input.scope, percent: Math.min(100, input.addPercent) }];
  return setQuotas(db, { tenantId: input.tenantId, quotas: next, userId: input.userId });
}
